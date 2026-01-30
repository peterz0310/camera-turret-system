#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <AccelStepper.h>
#include <ESP32Servo.h>
#include <math.h>

// Simple ring buffer for recent error messages sent to UI
const size_t MAX_ERROR_LOG = 6;
String errorLog[MAX_ERROR_LOG];
size_t errorLogCount = 0;
size_t errorLogHead = 0;

// WiFi and WebSocket settings
const char *ssid = "Apt 210";
const char *password = "mistycanoe3";
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

// Horizontal stepper motor settings (yaw)
const int H_STEP_PIN = 26;
const int H_DIR_PIN = 25;
const int H_HOME_PIN = 32; // Hall-effect sensor for yaw home (active LOW)

// Vertical stepper motor settings (up/down - tilt)
const int V_STEP_PIN = 14;
const int V_DIR_PIN = 12;
const int UP_LIMIT_PIN = 5;
const int DOWN_LIMIT_PIN = 4;
const bool VERTICAL_DIR_INVERT = false;    // Set true if tilt moves opposite of expected
const bool LIMIT_SWITCH_ACTIVE_LOW = true; // Set false if your limit switches are active HIGH

const int microstepFactor = 2;
const int baseMaxStepsPerSec = 500;
const float verticalSpeedScale = 0.5f; // Tilt moves at half the yaw speed
const int horizontalMaxStepsPerSec = baseMaxStepsPerSec * microstepFactor;
const int verticalMaxStepsPerSec = (int)(horizontalMaxStepsPerSec * verticalSpeedScale);
const float joystickSpeedLimit = 0.6;               // Clamp joystick speed to 60% of max
const float horizontalCalibrationSpeedFactor = 0.3; // Fraction of max speed during calibration (yaw)
const float verticalCalibrationSpeedFactor = 0.18;  // Slower tilt calibration sweep
const float verticalClearSpeedFactor = 0.10;        // Slowest tilt speed when clearing limits
const float effectiveHorizontalMaxStepsPerSec = horizontalMaxStepsPerSec * joystickSpeedLimit;
const float effectiveVerticalMaxStepsPerSec = verticalMaxStepsPerSec * joystickSpeedLimit;
const float joystickAccelStepsPerSec2 = 2500.0f;
const float joystickFilterTimeConstantSec = 0.12f;
const float jogReleaseTimeConstantSec = 0.06f; // Pull yaw target back quickly when stick is released
const float deadzone = 0.1;
const float speedExponent = 1.0; // Control speed curve: 1.0 = linear, 2.0 = exponential
const unsigned long CALIBRATION_TIMEOUT_MS = 15000;
const unsigned long CONTROL_TIMEOUT_MS = 750;       // Soft timeout: no new joystick packets
const unsigned long CONTROL_HARD_TIMEOUT_MS = 3000; // Hard timeout: stop even if WS stays connected

// Angular motion settings
const float HORIZONTAL_GEAR_RATIO = 4.0;  // 4:1 gear ratio for yaw
const float VERTICAL_GEAR_RATIO = 3.0;    // 2.25:1 gear ratio for tilt
const float STEPS_PER_REVOLUTION = 200.0; // Standard stepper motor (1.8° per step)
const float DEGREES_PER_REVOLUTION = 360.0;

// Calculate steps per degree for each axis (accounting for microstepping and gear ratios)
const float HORIZONTAL_STEPS_PER_DEGREE = (STEPS_PER_REVOLUTION * microstepFactor * HORIZONTAL_GEAR_RATIO) / DEGREES_PER_REVOLUTION;
const float VERTICAL_STEPS_PER_DEGREE = (STEPS_PER_REVOLUTION * microstepFactor * VERTICAL_GEAR_RATIO) / DEGREES_PER_REVOLUTION;
const long HORIZONTAL_FULL_ROTATION_STEPS = (long)(HORIZONTAL_STEPS_PER_DEGREE * DEGREES_PER_REVOLUTION);
const long HORIZONTAL_HALF_RANGE_STEPS = HORIZONTAL_FULL_ROTATION_STEPS / 2;

// Angular positioning variables
long horizontalCenterPosition = 0;
long verticalCenterPosition = 0;
bool angularPositioningEnabled = false;

// Servo motor settings for trigger
const int SERVO_PIN = 27;         // GPIO pin for servo control
const int SERVO_REST_ANGLE = 0;   // Rest position (trigger not pulled)
const int SERVO_FIRE_ANGLE = 90;  // Fire position (trigger pulled)
const int TRIGGER_DELAY_MS = 150; // How long to hold trigger pulled
const int BURST_SHOT_COUNT = 3;
const unsigned long BURST_SHOT_INTERVAL_MS = 500;
const unsigned long BURST_TOTAL_TIMEOUT_MS = BURST_SHOT_COUNT * BURST_SHOT_INTERVAL_MS;

// Servo and trigger control variables
Servo triggerServo;
volatile bool triggerActive = false; // Prevents overlapping trigger calls
unsigned long burstStartTime = 0;
int burstShotCount = 0;
bool inBurstMode = false;

// Non-blocking trigger timing variables
unsigned long triggerStartTime = 0;
bool triggerInFirePosition = false;
bool triggerReturning = false;

// Burst fire needs separate timing from individual trigger pulls
unsigned long nextBurstShotTime = 0;

// Limit switch variables
volatile bool upLimitHit = false;
volatile bool downLimitHit = false;
bool isHorizontalCalibrated = false;
bool isVerticalCalibrated = false;
long upLimitPosition = 0;
long downLimitPosition = 0;
volatile bool homeSensorTriggered = false;

// Global joystick values (updated via WebSocket)
volatile float joystickX = 0.0;
volatile float joystickY = 0.0;
volatile unsigned long lastControlMessageTime = 0;
float filteredJoystickX = 0.0f;
float filteredJoystickY = 0.0f;
float verticalSmoothedSpeed = 0.0f;

// Joystick chase targets (smoothed motion)
float horizontalJogTarget = 0.0f;
float verticalJogTarget = 0.0f;
unsigned long lastJogUpdateTime = 0;

// Calibration control flag
volatile bool calibrationInProgress = false;

// Movement mode control - prevents conflicts between joystick and angular positioning
volatile bool angularMovementInProgress = false;
unsigned long angularMovementStartTime = 0;
const unsigned long ANGULAR_MOVEMENT_TIMEOUT = 10000; // 10 seconds max for angular moves
unsigned long lastStatusSend = 0;
const unsigned long STATUS_INTERVAL_MS = 1000;

// Forward declarations
void cancelAngularMovement();
void homeTurret();
void stopAllMotion();
void syncJogTargetsToCurrent();
void resetJoystickFilter();
void sendStatus(bool movementComplete = false, bool calibrationCompleteFlag = false, bool yawHomed = false, bool tiltCalibrated = false);
void getCurrentAngles(float &horizontalAngle, float &verticalAngle);
void recordError(const String &msg);
void appendErrors(JsonArray &arr);

// Create AccelStepper instances
AccelStepper horizontalStepper(AccelStepper::DRIVER, H_STEP_PIN, H_DIR_PIN);
AccelStepper verticalStepper(AccelStepper::DRIVER, V_STEP_PIN, V_DIR_PIN);

// Interrupt service routines for limit switches and sensors
// These functions are called instantly when the inputs change state
void IRAM_ATTR homeSensorISR()
{
  homeSensorTriggered = digitalRead(H_HOME_PIN) == LOW;
}

void IRAM_ATTR upLimitISR()
{
  upLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(UP_LIMIT_PIN) == LOW) : (digitalRead(UP_LIMIT_PIN) == HIGH);
}

void IRAM_ATTR downLimitISR()
{
  downLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(DOWN_LIMIT_PIN) == LOW) : (digitalRead(DOWN_LIMIT_PIN) == HIGH);
}

bool canMoveUp()
{
  upLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(UP_LIMIT_PIN) == LOW) : (digitalRead(UP_LIMIT_PIN) == HIGH);
  return !upLimitHit;
}

bool canMoveDown()
{
  downLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(DOWN_LIMIT_PIN) == LOW) : (digitalRead(DOWN_LIMIT_PIN) == HIGH);
  return !downLimitHit;
}

bool isUpLimitActive()
{
  upLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(UP_LIMIT_PIN) == LOW) : (digitalRead(UP_LIMIT_PIN) == HIGH);
  return upLimitHit;
}

bool isDownLimitActive()
{
  downLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(DOWN_LIMIT_PIN) == LOW) : (digitalRead(DOWN_LIMIT_PIN) == HIGH);
  return downLimitHit;
}

bool isHomeSensorActive()
{
  return digitalRead(H_HOME_PIN) == LOW;
}

void getVerticalBounds(long &minPos, long &maxPos)
{
  if (downLimitPosition <= upLimitPosition)
  {
    minPos = downLimitPosition;
    maxPos = upLimitPosition;
  }
  else
  {
    minPos = upLimitPosition;
    maxPos = downLimitPosition;
  }
}

float wrapTo360(float angle)
{
  float wrapped = fmod(angle, 360.0f);
  if (wrapped < 0)
  {
    wrapped += 360.0f;
  }
  return wrapped;
}

float wrapTo180(float angle)
{
  float wrapped360 = wrapTo360(angle);
  if (wrapped360 > 180.0f)
  {
    wrapped360 -= 360.0f;
  }
  return wrapped360;
}

float shortestDeltaDegrees(float currentDeg, float targetDeg)
{
  float delta = targetDeg - currentDeg;
  while (delta > 180.0f)
  {
    delta -= 360.0f;
  }
  while (delta < -180.0f)
  {
    delta += 360.0f;
  }
  return delta;
}

void sendStatus(bool movementComplete, bool calibrationCompleteFlag, bool yawHomed, bool tiltCalibrated)
{
  if (ws.count() == 0)
  {
    return;
  }

  StaticJsonDocument<768> doc;
  JsonObject status = doc.createNestedObject("status");
  status["calibrated"] = angularPositioningEnabled;
  status["calibrating"] = calibrationInProgress;
  float hAngle = 0.0f, vAngle = 0.0f;
  getCurrentAngles(hAngle, vAngle);
  JsonObject angles = status.createNestedObject("angles");
  angles["horizontal"] = hAngle;
  angles["vertical"] = vAngle;
  JsonObject positions = status.createNestedObject("positions");
  positions["horizontal"] = horizontalStepper.currentPosition();
  positions["vertical"] = verticalStepper.currentPosition();
  JsonObject movement = status.createNestedObject("movement");
  movement["angularInProgress"] = angularMovementInProgress;
  movement["isMoving"] = fabs(horizontalStepper.speed()) > 0.5f || fabs(verticalStepper.speed()) > 0.5f;
  JsonObject sensors = status.createNestedObject("sensors");
  sensors["yawHome"] = isHomeSensorActive();
  sensors["tiltUp"] = upLimitHit;
  sensors["tiltDown"] = downLimitHit;
  status["triggerActive"] = triggerActive;

  if (movementComplete)
  {
    doc["movementComplete"] = true;
  }
  if (calibrationCompleteFlag)
  {
    doc["calibrationComplete"] = true;
    doc["yawHomed"] = yawHomed;
    doc["tiltCalibrated"] = tiltCalibrated;
  }

  JsonArray errors = doc.createNestedArray("errors");
  appendErrors(errors);

  String responseStr;
  serializeJson(doc, responseStr);
  ws.textAll(responseStr);
}

void stopAllMotion()
{
  horizontalStepper.setSpeed(0);
  verticalStepper.setSpeed(0);
  horizontalStepper.stop();
  verticalStepper.stop();
  verticalSmoothedSpeed = 0.0f;
}

void syncJogTargetsToCurrent()
{
  long hPos = horizontalStepper.currentPosition();
  long vPos = verticalStepper.currentPosition();
  horizontalJogTarget = (float)hPos;
  verticalJogTarget = (float)vPos;
  lastJogUpdateTime = millis();
}

void resetJoystickFilter()
{
  filteredJoystickX = 0.0f;
  filteredJoystickY = 0.0f;
  verticalSmoothedSpeed = 0.0f;
}

// Non-blocking trigger control functions
void startTriggerPull()
{
  if (triggerActive)
  {
    Serial.println("Trigger already active - ignoring command");
    return;
  }

  triggerActive = true;
  triggerInFirePosition = false;
  triggerReturning = false;
  triggerStartTime = millis();

  Serial.println("Starting trigger pull");
  triggerServo.write(SERVO_FIRE_ANGLE);
  triggerInFirePosition = true;
}

void updateTrigger()
{
  if (!triggerActive)
    return;

  unsigned long currentTime = millis();
  unsigned long elapsed = currentTime - triggerStartTime;

  if (triggerInFirePosition && !triggerReturning && elapsed >= TRIGGER_DELAY_MS)
  {
    // Time to return trigger to rest position
    triggerServo.write(SERVO_REST_ANGLE);
    triggerReturning = true;
    Serial.println("Returning trigger to rest");
  }
  else if (triggerReturning && elapsed >= (TRIGGER_DELAY_MS + 100))
  {
    // Trigger sequence complete
    triggerActive = false;
    triggerInFirePosition = false;
    triggerReturning = false;
    Serial.println("Trigger sequence complete");
  }
}

void fireSingleShot()
{
  if (triggerActive)
  {
    Serial.println("Trigger already active - ignoring single shot command");
    return;
  }

  Serial.println("Firing single shot");
  startTriggerPull();
}

void startBurstFire()
{
  if (triggerActive || inBurstMode)
  {
    Serial.println("Trigger or burst already active - ignoring burst fire command");
    return;
  }

  inBurstMode = true;
  burstShotCount = 0;
  burstStartTime = millis();
  nextBurstShotTime = burstStartTime; // First shot fires immediately
  Serial.printf("Starting burst fire mode (%d shots, %lums interval)\n",
                BURST_SHOT_COUNT, BURST_SHOT_INTERVAL_MS);
}

void updateBurstFire()
{
  if (!inBurstMode)
    return;

  unsigned long currentTime = millis();

  // Check if we can fire the next shot (trigger must be ready)
  if (burstShotCount < BURST_SHOT_COUNT && !triggerActive && currentTime >= nextBurstShotTime)
  {
    Serial.printf("Firing burst shot %d/%d\n", burstShotCount + 1, BURST_SHOT_COUNT);
    startTriggerPull();
    burstShotCount++;

    // Schedule next shot based on configured interval
    nextBurstShotTime = currentTime + BURST_SHOT_INTERVAL_MS;
  }

  // End burst mode after timeout or all shots fired
  unsigned long elapsedTime = currentTime - burstStartTime;
  if (elapsedTime >= BURST_TOTAL_TIMEOUT_MS || burstShotCount >= BURST_SHOT_COUNT)
  {
    inBurstMode = false;
    Serial.println("Burst fire complete");
  }
}

// Calibration function - moves to both limits to establish working range
bool calibrateHorizontalMotor()
{
  Serial.println("Starting horizontal motor calibration using hall-effect home sensor...");
  isHorizontalCalibrated = false;
  homeSensorTriggered = isHomeSensorActive();
  unsigned long startTime = millis();

  // If sensor is already triggered, gently move off it first
  if (homeSensorTriggered)
  {
    Serial.println("Home sensor active on start - backing off slowly");
    horizontalStepper.setMaxSpeed(horizontalMaxStepsPerSec * 0.15);
    long backoffStart = horizontalStepper.currentPosition();
    horizontalStepper.moveTo(backoffStart - (long)(HORIZONTAL_STEPS_PER_DEGREE * 10));
    while (isHomeSensorActive())
    {
      horizontalStepper.run();
      if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
      {
        Serial.println("Timeout while backing off home sensor");
        horizontalStepper.stop();
        return false;
      }
      delay(1);
    }
    horizontalStepper.stop();
    homeSensorTriggered = false;
    delay(150);
  }

  const long searchStartPosition = horizontalStepper.currentPosition();
  const long maxSearchSteps = (long)(HORIZONTAL_FULL_ROTATION_STEPS * 1.5); // Up to 1.5 revolutions
  bool homeFound = false;

  Serial.println("Sweeping yaw to find home sensor...");
  horizontalStepper.setMaxSpeed(horizontalMaxStepsPerSec * horizontalCalibrationSpeedFactor);
  horizontalStepper.moveTo(searchStartPosition + maxSearchSteps);
  while (labs(horizontalStepper.currentPosition() - searchStartPosition) < maxSearchSteps)
  {
    horizontalStepper.run();
    if (homeSensorTriggered || isHomeSensorActive())
    {
      homeFound = true;
      break;
    }
    if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
    {
      Serial.println("Timeout while searching for yaw home sensor");
      break;
    }
    delay(1);
  }
  horizontalStepper.stop();
  horizontalStepper.setMaxSpeed(effectiveHorizontalMaxStepsPerSec);

  if (!homeFound)
  {
    Serial.println("ERROR: Home sensor not detected during yaw calibration");
    return false;
  }

  // Zero position at the sensor
  horizontalStepper.setCurrentPosition(0);
  horizontalCenterPosition = 0;
  isHorizontalCalibrated = true;
  homeSensorTriggered = false;

  Serial.println("Horizontal calibration complete!");
  Serial.println("Yaw home set at 0° with continuous rotation enabled (slip ring)");
  return true;
}

bool calibrateVerticalMotor()
{
  Serial.println("Starting vertical motor calibration...");
  isVerticalCalibrated = false;
  Serial.printf("Initial limit states - Up: %s, Down: %s\n",
                upLimitHit ? "HIT" : "OK", downLimitHit ? "HIT" : "OK");
  const long maxVerticalSearchSteps = (long)(VERTICAL_STEPS_PER_DEGREE * 200); // ~200° equivalent travel
  bool downFound = false;
  bool upFound = false;
  unsigned long startTime = millis();

  // Set calibration speed - moderate pace, not too slow
  verticalStepper.setMaxSpeed(verticalMaxStepsPerSec * verticalCalibrationSpeedFactor);

  // If already at down limit, gently move up to clear it
  if (isDownLimitActive())
  {
    Serial.println("Down limit active at start, clearing...");
    long clearStart = verticalStepper.currentPosition();
    verticalStepper.moveTo(clearStart + (long)(VERTICAL_STEPS_PER_DEGREE * 10));
    while (isDownLimitActive() && labs(verticalStepper.currentPosition() - clearStart) < maxVerticalSearchSteps)
    {
      verticalStepper.run();
      if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
      {
        Serial.println("Timeout while clearing down limit");
        verticalStepper.stop();
        return false;
      }
      delay(1);
    }
    verticalStepper.stop();
    delay(50);
  }

  // If already at up limit, gently move down to clear it
  if (isUpLimitActive())
  {
    Serial.println("Up limit active at start, clearing...");
    long clearStart = verticalStepper.currentPosition();
    verticalStepper.moveTo(clearStart - (long)(VERTICAL_STEPS_PER_DEGREE * 10));
    while (isUpLimitActive() && labs(verticalStepper.currentPosition() - clearStart) < maxVerticalSearchSteps)
    {
      verticalStepper.run();
      if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
      {
        Serial.println("Timeout while clearing up limit");
        verticalStepper.stop();
        return false;
      }
      delay(1);
    }
    verticalStepper.stop();
    delay(50);
  }

  // Move down to find the down limit - stop when switch activates
  Serial.println("Finding down limit...");
  long downSearchStart = verticalStepper.currentPosition();
  verticalStepper.moveTo(downSearchStart - maxVerticalSearchSteps);
  while (labs(verticalStepper.currentPosition() - downSearchStart) < maxVerticalSearchSteps)
  {
    if (isDownLimitActive())
    {
      downFound = true;
      verticalStepper.stop();
      downLimitPosition = verticalStepper.currentPosition();
      Serial.printf("Down limit found at position: %ld\n", downLimitPosition);
      break;
    }
    verticalStepper.run();
    if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
    {
      Serial.println("Timeout searching for down limit");
      verticalStepper.stop();
      break;
    }
    delay(1);
  }
  verticalStepper.stop();
  delay(50);

  if (!downFound)
  {
    downLimitPosition = verticalStepper.currentPosition();
    Serial.printf("Down limit not found (last position: %ld)\n", downLimitPosition);
  }

  // Move up to find the up limit - stop when switch activates
  Serial.println("Finding up limit...");
  long upSearchStart = verticalStepper.currentPosition();
  verticalStepper.moveTo(upSearchStart + maxVerticalSearchSteps);
  while (labs(verticalStepper.currentPosition() - upSearchStart) < maxVerticalSearchSteps)
  {
    if (isUpLimitActive())
    {
      upFound = true;
      verticalStepper.stop();
      upLimitPosition = verticalStepper.currentPosition();
      Serial.printf("Up limit found at position: %ld\n", upLimitPosition);
      break;
    }
    verticalStepper.run();
    if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
    {
      Serial.println("Timeout searching for up limit");
      verticalStepper.stop();
      break;
    }
    delay(1);
  }
  verticalStepper.stop();
  delay(50);

  if (!upFound)
  {
    upLimitPosition = verticalStepper.currentPosition();
    Serial.printf("Up limit not found (last position: %ld)\n", upLimitPosition);
  }

  if (downFound && upFound)
  {
    // Move to center
    long centerPosition = (downLimitPosition + upLimitPosition) / 2;
    verticalCenterPosition = centerPosition;
    verticalStepper.moveTo(centerPosition);
    while (verticalStepper.distanceToGo() != 0)
    {
      verticalStepper.run();
    }

    isVerticalCalibrated = true;
    verticalStepper.setMaxSpeed(effectiveVerticalMaxStepsPerSec);
    Serial.println("Vertical calibration complete!");
    long vMin = 0;
    long vMax = 0;
    getVerticalBounds(vMin, vMax);
    Serial.printf("Vertical working range: %ld to %ld steps (%ld total)\n",
                  vMin, vMax,
                  vMax - vMin);
    return true;
  }

  isVerticalCalibrated = false;
  Serial.println("WARNING: Vertical calibration incomplete - limit switches not detected as expected");
  verticalStepper.setMaxSpeed(effectiveVerticalMaxStepsPerSec);
  return false;
}

void calibrateMotors()
{
  Serial.println("Starting motor calibration - pausing motor task...");
  calibrationInProgress = true;
  cancelAngularMovement();
  delay(100); // Give motor task time to pause

  unsigned long calibrationStart = millis();
  bool horizontalOk = calibrateHorizontalMotor();
  if (millis() - calibrationStart > CALIBRATION_TIMEOUT_MS)
  {
    Serial.println("Calibration timeout reached during yaw homing");
    stopAllMotion();
  }

  bool verticalOk = calibrateVerticalMotor();
  if (millis() - calibrationStart > (CALIBRATION_TIMEOUT_MS * 2))
  {
    Serial.println("Calibration timeout reached during tilt sweep");
    stopAllMotion();
  }

  angularPositioningEnabled = horizontalOk && verticalOk;

  calibrationInProgress = false; // Resume motor task
  syncJogTargetsToCurrent();
  if (angularPositioningEnabled)
  {
    Serial.println("All motors calibrated! Motor task resumed.");
    Serial.printf("Angular positioning enabled - Center positions: H=%ld, V=%ld\n",
                  horizontalCenterPosition, verticalCenterPosition);
    Serial.printf("Steps per degree - Horizontal: %.2f, Vertical: %.2f\n",
                  HORIZONTAL_STEPS_PER_DEGREE, VERTICAL_STEPS_PER_DEGREE);
  }
  else
  {
    Serial.println("Calibration incomplete - check sensors/limit switches");
  }
  sendStatus(false, true, horizontalOk, verticalOk);
}

void homeTurret()
{
  if (!angularPositioningEnabled)
  {
    Serial.println("System not calibrated - running full calibration before homing");
    calibrateMotors();
    return;
  }

  Serial.println("Starting homing sequence (yaw hall sensor + tilt center)...");
  calibrationInProgress = true;
  cancelAngularMovement();
  horizontalStepper.setSpeed(0);
  verticalStepper.setSpeed(0);
  delay(50);

  bool yawOk = calibrateHorizontalMotor();

  // Move tilt back to center using known range
  verticalStepper.moveTo(verticalCenterPosition);
  while (verticalStepper.distanceToGo() != 0)
  {
    verticalStepper.run();
  }

  angularPositioningEnabled = yawOk && isVerticalCalibrated;
  calibrationInProgress = false;
  syncJogTargetsToCurrent();

  StaticJsonDocument<96> response;
  response["homeComplete"] = true;
  response["yawHomed"] = yawOk;
  response["tiltCentered"] = true;
  String responseStr;
  serializeJson(response, responseStr);
  if (ws.count() > 0)
  {
    ws.textAll(responseStr);
  }

  Serial.println("Homing sequence complete");
  sendStatus(false, false, yawOk, isVerticalCalibrated);
}

// Angular motion functions
long degreesToSteps(float degrees, bool isHorizontal)
{
  if (isHorizontal)
  {
    return (long)(degrees * HORIZONTAL_STEPS_PER_DEGREE);
  }
  else
  {
    return (long)(degrees * VERTICAL_STEPS_PER_DEGREE);
  }
}

float stepsToDegrees(long steps, bool isHorizontal)
{
  if (isHorizontal)
  {
    return (float)steps / HORIZONTAL_STEPS_PER_DEGREE;
  }
  else
  {
    return (float)steps / VERTICAL_STEPS_PER_DEGREE;
  }
}

bool moveToAbsoluteAngle(float horizontalDegrees, float verticalDegrees)
{
  if (calibrationInProgress)
  {
    Serial.println("Calibration in progress - cannot move to angle");
    recordError("Move rejected: calibration in progress");
    return false;
  }

  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    recordError("Move rejected: turret not calibrated");
    return false;
  }

  // Horizontal (yaw) with slip ring: wrap target to 0-360 and take shortest path
  float currentHorizontalAngle = wrapTo360(stepsToDegrees(horizontalStepper.currentPosition() - horizontalCenterPosition, true));
  float targetHorizontalAngle = wrapTo360(horizontalDegrees);
  float horizontalDelta = shortestDeltaDegrees(currentHorizontalAngle, targetHorizontalAngle);
  long targetHorizontalPosition = horizontalStepper.currentPosition() + degreesToSteps(horizontalDelta, true);

  long targetVerticalPosition = verticalCenterPosition + degreesToSteps(verticalDegrees, false);

  // Check if targets are within limits (tilt only)
  long vMin = 0;
  long vMax = 0;
  getVerticalBounds(vMin, vMax);
  if (targetVerticalPosition < vMin || targetVerticalPosition > vMax)
  {
    Serial.printf("Vertical target %.2f° (pos %ld) exceeds limits [%ld, %ld]\n",
                  verticalDegrees, targetVerticalPosition, vMin, vMax);
    recordError("Move rejected: vertical target out of limits");
    return false;
  }

  Serial.printf("Moving to absolute angles: H=%.2f° (delta %.2f°) V=%.2f° (positions: H=%ld V=%ld)\n",
                targetHorizontalAngle, horizontalDelta, verticalDegrees, targetHorizontalPosition, targetVerticalPosition);

  // Set angular movement mode to prevent joystick interference
  angularMovementInProgress = true;
  angularMovementStartTime = millis();

  horizontalStepper.moveTo(targetHorizontalPosition);
  verticalStepper.moveTo(targetVerticalPosition);

  return true;
}

bool moveByRelativeAngle(float horizontalDegrees, float verticalDegrees)
{
  if (calibrationInProgress)
  {
    Serial.println("Calibration in progress - cannot move by relative angle");
    recordError("Relative move rejected: calibration in progress");
    return false;
  }

  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    recordError("Relative move rejected: turret not calibrated");
    return false;
  }

  // Calculate relative movement in steps
  long horizontalSteps = degreesToSteps(horizontalDegrees, true);
  long verticalSteps = degreesToSteps(verticalDegrees, false);

  // Calculate target positions
  long targetHorizontalPosition = horizontalStepper.currentPosition() + horizontalSteps;
  long targetVerticalPosition = verticalStepper.currentPosition() + verticalSteps;

  // Check if targets are within limits (tilt only)
  long vMin = 0;
  long vMax = 0;
  getVerticalBounds(vMin, vMax);
  if (targetVerticalPosition < vMin || targetVerticalPosition > vMax)
  {
    Serial.printf("Relative vertical move %.2f° would exceed limits\n", verticalDegrees);
    recordError("Relative move rejected: vertical target out of limits");
    return false;
  }

  Serial.printf("Moving by relative angles: H=%.2f° V=%.2f° (steps: H=%ld V=%ld)\n",
                horizontalDegrees, verticalDegrees, horizontalSteps, verticalSteps);

  // Set angular movement mode to prevent joystick interference
  angularMovementInProgress = true;
  angularMovementStartTime = millis();

  horizontalStepper.move(horizontalSteps);
  verticalStepper.move(verticalSteps);

  return true;
}

void getCurrentAngles(float &horizontalAngle, float &verticalAngle)
{
  if (!angularPositioningEnabled)
  {
    horizontalAngle = 0.0;
    verticalAngle = 0.0;
    return;
  }

  long horizontalOffset = horizontalStepper.currentPosition() - horizontalCenterPosition;
  long verticalOffset = verticalStepper.currentPosition() - verticalCenterPosition;

  float absoluteYaw = wrapTo360(stepsToDegrees(horizontalOffset, true));
  horizontalAngle = wrapTo180(absoluteYaw); // Report in -180..180 for easier readability
  verticalAngle = stepsToDegrees(verticalOffset, false);
}

void appendErrors(JsonArray &arr)
{
  for (size_t i = 0; i < errorLogCount; i++)
  {
    size_t idx = (errorLogHead + MAX_ERROR_LOG - errorLogCount + i) % MAX_ERROR_LOG;
    arr.add(errorLog[idx]);
  }
}

void recordError(const String &msg)
{
  errorLog[errorLogHead] = msg;
  errorLogHead = (errorLogHead + 1) % MAX_ERROR_LOG;
  if (errorLogCount < MAX_ERROR_LOG)
  {
    errorLogCount++;
  }

  // Push immediate notification to connected clients
  if (ws.count() > 0)
  {
    StaticJsonDocument<196> doc;
    doc["error"] = msg;
    JsonArray errors = doc.createNestedArray("errors");
    appendErrors(errors);
    String payload;
    serializeJson(doc, payload);
    ws.textAll(payload);
  }
}

bool moveToCenter()
{
  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    return false;
  }

  Serial.println("Moving to center position (0°, 0°)");
  return moveToAbsoluteAngle(0.0, 0.0);
}

void motorTask(void *parameter)
{
  // Used to throttle logging frequency
  unsigned long lastLogTime = 0;

  for (;;)
  {
    if (lastJogUpdateTime == 0)
    {
      syncJogTargetsToCurrent();
    }

    // Pause motor task during calibration
    if (calibrationInProgress)
    {
      vTaskDelay(50 / portTICK_PERIOD_MS); // Wait 50ms and check again
      continue;
    }

    // Handle burst fire timing
    updateBurstFire();

    // Handle non-blocking trigger control
    updateTrigger();

    // Fail-safe: stop motors if control input goes quiet while in joystick mode
    static bool controlTimeoutActive = false;
    unsigned long now = millis();
    bool noClients = (ws.count() == 0);
    unsigned long inputAge = now - lastControlMessageTime;
    bool hardStale = inputAge > CONTROL_HARD_TIMEOUT_MS;

    if (!angularMovementInProgress && (noClients || hardStale))
    {
      if (!controlTimeoutActive &&
          (fabs(horizontalStepper.speed()) > 0.5f || fabs(verticalStepper.speed()) > 0.5f))
      {
        joystickX = 0.0f;
        joystickY = 0.0f;
        resetJoystickFilter();
        syncJogTargetsToCurrent();
        stopAllMotion();
        Serial.println("Control timeout - stopping motors");
        sendStatus(false, false, false, false);
      }
      controlTimeoutActive = true;
    }
    else if (controlTimeoutActive)
    {
      controlTimeoutActive = false;
    }

    // Check if angular movement is in progress
    if (angularMovementInProgress)
    {
      // Check for timeout to prevent getting stuck
      unsigned long currentTime = millis();
      if (currentTime - angularMovementStartTime > ANGULAR_MOVEMENT_TIMEOUT)
      {
        Serial.println("Angular movement timeout - resuming joystick control");
        angularMovementInProgress = false;
        syncJogTargetsToCurrent();
        sendStatus(true, false, false, false);
      }
      else
      {
        // Check if both motors have reached their targets
        bool horizontalReached = (horizontalStepper.distanceToGo() == 0);
        bool verticalReached = (verticalStepper.distanceToGo() == 0);

        if (horizontalReached && verticalReached)
        {
          Serial.println("Angular movement complete - resuming joystick control");
          angularMovementInProgress = false;
          syncJogTargetsToCurrent();
          sendStatus(true, false, false, false);
        }
        else
        {
          // Continue angular movement - use run() instead of runSpeed()
          horizontalStepper.run();
          verticalStepper.run();

          // Log progress every 500ms
          if (currentTime - lastLogTime >= 500)
          {
            lastLogTime = currentTime;
            Serial.printf("Angular move in progress - H_target: %ld (current: %ld, remaining: %ld) | V_target: %ld (current: %ld, remaining: %ld)\n",
                          horizontalStepper.targetPosition(), horizontalStepper.currentPosition(), horizontalStepper.distanceToGo(),
                          verticalStepper.targetPosition(), verticalStepper.currentPosition(), verticalStepper.distanceToGo());
          }

          // Skip joystick processing while angular movement is active
          vTaskDelay(1 / portTICK_PERIOD_MS);
          continue;
        }
      }
    }

    // Normal joystick control mode (only when not in angular movement)
    float currentX = joystickX;
    float currentY = joystickY;
    unsigned long nowMs = millis();
    unsigned long dtMs = nowMs - lastJogUpdateTime;
    if (dtMs > 100)
    {
      dtMs = 100; // Clamp to avoid large jumps after stalls
    }
    float dt = dtMs / 1000.0f;
    lastJogUpdateTime = nowMs;

    if (dt > 0.0f)
    {
      float alpha = dt / (joystickFilterTimeConstantSec + dt);
      filteredJoystickX += alpha * (currentX - filteredJoystickX);
      filteredJoystickY += alpha * (currentY - filteredJoystickY);
    }
    else
    {
      filteredJoystickX = currentX;
      filteredJoystickY = currentY;
    }

    currentX = filteredJoystickX;
    currentY = filteredJoystickY;
    float currentHorizontalSpeed = 0.0f;
    float currentVerticalSpeed = 0.0f;
    bool verticalBlocked = false;

    // Handle horizontal movement (X-axis)
    if (fabs(currentX) > deadzone)
    {
      float normX = (fabs(currentX) - deadzone) / (1.0 - deadzone);
      float mappedSpeed = pow(normX, speedExponent) * effectiveHorizontalMaxStepsPerSec;

      currentHorizontalSpeed = (currentX > 0) ? mappedSpeed : -mappedSpeed;
    }
    else
    {
      currentHorizontalSpeed = 0;
    }

    // Handle vertical movement (Y-axis)
    if (fabs(currentY) > deadzone)
    {
      float normY = (fabs(currentY) - deadzone) / (1.0 - deadzone);
      float mappedSpeed = pow(normY, speedExponent) * effectiveVerticalMaxStepsPerSec;

      // Check limit switches before setting speed
      if (currentY > 0 && canMoveUp())
      { // Moving up
        currentVerticalSpeed = mappedSpeed;
      }
      else if (currentY < 0 && canMoveDown())
      { // Moving down
        currentVerticalSpeed = -mappedSpeed;
      }
      else
      {
        // Hit a limit switch or trying to move into a limit
        currentVerticalSpeed = 0;
        verticalBlocked = true;
      }
    }
    else
    {
      currentVerticalSpeed = 0;
    }

    // Integrate joystick velocity into moving target position (yaw only)
    if (fabs(currentX) > deadzone)
    {
      horizontalJogTarget += currentHorizontalSpeed * dt;
    }
    else
    {
      // When the stick is released, pull the target back to current position quickly
      float releaseAlpha = dt / (jogReleaseTimeConstantSec + dt);
      horizontalJogTarget += (horizontalStepper.currentPosition() - horizontalJogTarget) * releaseAlpha;
    }

    long hTargetSteps = lroundf(horizontalJogTarget);

    // Apply targets and run with acceleration smoothing
    horizontalStepper.moveTo(hTargetSteps);
    horizontalStepper.run();

    // Tilt uses speed mode with slew-limited speed for smoother low-speed motion
    float targetVerticalSpeed = currentVerticalSpeed;
    if (verticalBlocked)
    {
      verticalSmoothedSpeed = 0.0f;
      targetVerticalSpeed = 0.0f;
    }
    float maxDelta = joystickAccelStepsPerSec2 * dt;
    float delta = targetVerticalSpeed - verticalSmoothedSpeed;
    if (delta > maxDelta)
    {
      delta = maxDelta;
    }
    else if (delta < -maxDelta)
    {
      delta = -maxDelta;
    }
    verticalSmoothedSpeed += delta;
    verticalStepper.setSpeed(verticalSmoothedSpeed);
    verticalStepper.runSpeed();

    // Log the status every 500ms to avoid flooding the serial monitor
    unsigned long currentMillis = millis();
    if (currentMillis - lastLogTime >= 500)
    {
      lastLogTime = currentMillis;
      float horizontalPercentSpeed = (fabs(currentHorizontalSpeed) / effectiveHorizontalMaxStepsPerSec) * 100.0;
      float verticalPercentSpeed = (fabs(currentVerticalSpeed) / effectiveVerticalMaxStepsPerSec) * 100.0;
      Serial.printf("Joy: X=%.3f Y=%.3f | H: %.1f%% V: %.1f%% | Home:%s | TiltLimits: U=%s D=%s | H_Pos: %ld V_Pos: %ld | Trigger: %s | Cal: H=%s V=%s | Mode: %s\n",
                    currentX, currentY,
                    horizontalPercentSpeed, verticalPercentSpeed,
                    isHomeSensorActive() ? "ON" : "OFF",
                    upLimitHit ? "HIT" : "OK",
                    downLimitHit ? "HIT" : "OK",
                    horizontalStepper.currentPosition(),
                    verticalStepper.currentPosition(),
                    triggerActive ? "ACTIVE" : "READY",
                    isHorizontalCalibrated ? "YES" : "NO",
                    isVerticalCalibrated ? "YES" : "NO",
                    angularMovementInProgress ? "ANGULAR" : "JOYSTICK");
    }

    // Periodic status broadcast to UI
    if (currentMillis - lastStatusSend >= STATUS_INTERVAL_MS)
    {
      lastStatusSend = currentMillis;
      sendStatus(false, false, false, false);
    }

    // Minimal delay to yield to other tasks
    vTaskDelay(1 / portTICK_PERIOD_MS);
  }
}

void onWebSocketEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len)
{
  switch (type)
  {
  case WS_EVT_CONNECT:
    Serial.printf("WebSocket client connected: %u\n", client->id());
    lastControlMessageTime = millis();
    joystickX = 0.0f;
    joystickY = 0.0f;
    resetJoystickFilter();
    syncJogTargetsToCurrent();
    stopAllMotion();
    break;
  case WS_EVT_DISCONNECT:
    Serial.printf("WebSocket client disconnected: %u\n", client->id());
    joystickX = 0.0f;
    joystickY = 0.0f;
    resetJoystickFilter();
    angularMovementInProgress = false;
    syncJogTargetsToCurrent();
    stopAllMotion();
    horizontalStepper.stop();
    verticalStepper.stop();
    lastControlMessageTime = millis();
    Serial.println("Motion halted due to WebSocket disconnect");
    sendStatus(false, false, false, false);
    break;
  case WS_EVT_DATA:
  {
    StaticJsonDocument<200> doc;
    DeserializationError error = deserializeJson(doc, data, len);
    if (error)
    {
      Serial.print("deserializeJson() failed: ");
      Serial.println(error.c_str());
      recordError("Bad JSON from client");
      return;
    }
    if (doc.containsKey("x"))
    {
      joystickX = doc["x"].as<float>();
      lastControlMessageTime = millis();

      // Cancel angular movement if significant joystick input is detected
      if (angularMovementInProgress && fabs(joystickX) > deadzone)
      {
        Serial.println("Joystick input detected - cancelling angular movement");
        cancelAngularMovement();
      }
    }
    if (doc.containsKey("y"))
    {
      joystickY = doc["y"].as<float>();
      lastControlMessageTime = millis();

      // Cancel angular movement if significant joystick input is detected
      if (angularMovementInProgress && fabs(joystickY) > deadzone)
      {
        Serial.println("Joystick input detected - cancelling angular movement");
        cancelAngularMovement();
      }
    }

    // Check for calibration command
    if (doc.containsKey("calibrate") && doc["calibrate"].as<bool>())
    {
      Serial.println("Calibration requested via WebSocket");
      calibrateMotors();
    }

    if (doc.containsKey("home") && doc["home"].as<bool>())
    {
      Serial.println("Home requested via WebSocket");
      homeTurret();
    }

    // Check for trigger commands
    if (doc.containsKey("fire"))
    {
      String fireMode = doc["fire"].as<String>();
      if (fireMode == "single")
      {
        fireSingleShot();
      }
      else if (fireMode == "burst")
      {
        startBurstFire();
      }
      else
      {
        Serial.println("Unknown fire mode: " + fireMode);
        recordError("Unknown fire mode: " + fireMode);
      }
    }

    // Check for angular movement commands
    if (doc.containsKey("moveToAngle"))
    {
      float horizontalAngle = doc["moveToAngle"]["horizontal"].as<float>();
      float verticalAngle = doc["moveToAngle"]["vertical"].as<float>();
      moveToAbsoluteAngle(horizontalAngle, verticalAngle);
    }

    if (doc.containsKey("moveByAngle"))
    {
      float horizontalAngle = doc["moveByAngle"]["horizontal"].as<float>();
      float verticalAngle = doc["moveByAngle"]["vertical"].as<float>();
      moveByRelativeAngle(horizontalAngle, verticalAngle);
    }

    if (doc.containsKey("moveToCenter") && doc["moveToCenter"].as<bool>())
    {
      moveToCenter();
    }

    // Check for cancel angular movement command
    if (doc.containsKey("cancelAngularMovement") && doc["cancelAngularMovement"].as<bool>())
    {
      cancelAngularMovement();
    }

    if (doc.containsKey("getCurrentAngles") && doc["getCurrentAngles"].as<bool>())
    {
      float horizontalAngle, verticalAngle;
      getCurrentAngles(horizontalAngle, verticalAngle);

      // Send back current angles via WebSocket
      StaticJsonDocument<200> response;
      response["currentAngles"]["horizontal"] = horizontalAngle;
      response["currentAngles"]["vertical"] = verticalAngle;
      response["positions"]["horizontal"] = horizontalStepper.currentPosition();
      response["positions"]["vertical"] = verticalStepper.currentPosition();
      response["calibrated"] = angularPositioningEnabled;

      String responseStr;
      serializeJson(response, responseStr);
      server->textAll(responseStr);

      Serial.printf("Current angles - H: %.2f°, V: %.2f°\n", horizontalAngle, verticalAngle);
    }
    break;
  }
  default:
    break;
  }
}

void setup()
{
  Serial.begin(115200);
  delay(1000);
  Serial.println("Starting ESP32 WebSocket and Stepper Motor Control");
  lastControlMessageTime = millis();

  // Setup sensor pins with internal pull-up resistors
  pinMode(H_HOME_PIN, INPUT_PULLUP);
  pinMode(UP_LIMIT_PIN, INPUT_PULLUP);
  pinMode(DOWN_LIMIT_PIN, INPUT_PULLUP);

  // Attach interrupts for sensors
  attachInterrupt(digitalPinToInterrupt(H_HOME_PIN), homeSensorISR, FALLING);
  attachInterrupt(digitalPinToInterrupt(UP_LIMIT_PIN), upLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(DOWN_LIMIT_PIN), downLimitISR, CHANGE);

  // Initialize sensor states
  homeSensorTriggered = digitalRead(H_HOME_PIN) == LOW;
  upLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(UP_LIMIT_PIN) == LOW) : (digitalRead(UP_LIMIT_PIN) == HIGH);
  downLimitHit = LIMIT_SWITCH_ACTIVE_LOW ? (digitalRead(DOWN_LIMIT_PIN) == LOW) : (digitalRead(DOWN_LIMIT_PIN) == HIGH);

  Serial.printf("Initial sensor states - Yaw home: %s, Up: %s, Down: %s\n",
                homeSensorTriggered ? "ACTIVE" : "CLEAR",
                upLimitHit ? "HIT" : "OK", downLimitHit ? "HIT" : "OK");

  // Check for problematic vertical limit switch configuration
  if (upLimitHit && downLimitHit)
  {
    Serial.println("WARNING: Both vertical limit switches are triggered!");
    Serial.println("This may indicate a wiring issue or mechanical problem.");
    Serial.println("Check your UP_LIMIT_PIN (4) and DOWN_LIMIT_PIN (5) connections.");
  }

  // Initialize stepper settings
  horizontalStepper.setMaxSpeed(effectiveHorizontalMaxStepsPerSec);
  verticalStepper.setMaxSpeed(effectiveVerticalMaxStepsPerSec);
  horizontalStepper.setAcceleration(joystickAccelStepsPerSec2);
  verticalStepper.setAcceleration(joystickAccelStepsPerSec2);
  verticalStepper.setPinsInverted(VERTICAL_DIR_INVERT, false, false); // Tilt direction configuration

  // Initialize servo motor for trigger
  triggerServo.setPeriodHertz(50);           // Standard 50Hz servo
  triggerServo.attach(SERVO_PIN, 500, 2500); // Min/Max pulse width in microseconds
  triggerServo.write(SERVO_REST_ANGLE);      // Set to rest position
  delay(500);                                // Give servo time to reach position
  Serial.println("Trigger servo initialized at rest position");

  Serial.println("Waiting 1 second before motion...");
  delay(1000); // Safety delay after power-on

  Serial.println("Running startup calibration...");
  calibrateMotors();
  syncJogTargetsToCurrent();

  // Connect to WiFi
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected, IP address: ");
  Serial.println(WiFi.localIP());

  // Setup WebSocket
  ws.onEvent(onWebSocketEvent);
  server.addHandler(&ws);
  server.begin();

  // Create a separate task for motor control on the other core
  xTaskCreatePinnedToCore(
      motorTask,   // Task function
      "MotorTask", // Name of task
      2048,        // Stack size in words
      NULL,        // Task input parameter
      1,           // Priority of the task
      NULL,        // Task handle
      1            // Core where the task should run (0 or 1)
  );

  Serial.println("System ready!");
  Serial.println("Available WebSocket commands:");
  Serial.println("  - {\"calibrate\": true} - Calibrate yaw home + tilt limits");
  Serial.println("  - {\"home\": true} - Re-home yaw (hall) and recenter tilt");
  Serial.println("  - {\"fire\": \"single\"} - Fire single shot");
  Serial.printf("  - {\"fire\": \"burst\"} - Fire %d-shot burst\n", BURST_SHOT_COUNT);
  Serial.println("  - {\"x\": 0.5, \"y\": 0.0} - Control turret movement (joystick mode)");
  Serial.println("  - {\"moveToAngle\": {\"horizontal\": 45.0, \"vertical\": -10.0}} - Move to absolute angles");
  Serial.println("  - {\"moveByAngle\": {\"horizontal\": 5.0, \"vertical\": 2.0}} - Move by relative angles");
  Serial.println("  - {\"moveToCenter\": true} - Move to center position (0°, 0°)");
  Serial.println("  - {\"cancelAngularMovement\": true} - Cancel ongoing angular movement");
  Serial.println("  - {\"getCurrentAngles\": true} - Get current turret angles");
  Serial.println("Note: Joystick input automatically cancels angular movement for safety");
}

void loop()
{
  yield();
}

void cancelAngularMovement()
{
  if (angularMovementInProgress)
  {
    Serial.println("Cancelling angular movement - resuming joystick control");
    angularMovementInProgress = false;

    // Stop both motors
    stopAllMotion();
    syncJogTargetsToCurrent();
  }

  sendStatus(false, false, false, false);
}
