#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <AccelStepper.h>
#include <ESP32Servo.h>

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
const int UP_LIMIT_PIN = 4;
const int DOWN_LIMIT_PIN = 5;

const int microstepFactor = 2;
const int baseMaxStepsPerSec = 500; // Lowered to keep motion safe
const int maxStepsPerSec = baseMaxStepsPerSec * microstepFactor;
const float joystickSpeedLimit = 0.6; // Clamp joystick speed to 60% of max
const float calibrationSpeedFactor = 0.3; // Fraction of max speed during calibration
const float effectiveMaxStepsPerSec = maxStepsPerSec * joystickSpeedLimit;
const float deadzone = 0.1;
const float speedExponent = 1.0; // Control speed curve: 1.0 = linear, 2.0 = exponential
const unsigned long CALIBRATION_TIMEOUT_MS = 15000;

// Angular motion settings - configurable gear ratios and motor specs
const float HORIZONTAL_GEAR_RATIO = 4.0;  // 4:1 gear ratio for yaw
const float VERTICAL_GEAR_RATIO = 3.0;    // 3:1 gear ratio for tilt
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
const int SERVO_PIN = 27;            // GPIO pin for servo control
const int SERVO_REST_ANGLE = 0;      // Rest position (trigger not pulled)
const int SERVO_FIRE_ANGLE = 90;     // Fire position (trigger pulled)
const int TRIGGER_DELAY_MS = 150;    // How long to hold trigger pulled
const int BURST_SHOT_DELAY_MS = 500; // Delay between shots in burst mode

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

// Calibration control flag
volatile bool calibrationInProgress = false;

// Movement mode control - prevents conflicts between joystick and angular positioning
volatile bool angularMovementInProgress = false;
unsigned long angularMovementStartTime = 0;
const unsigned long ANGULAR_MOVEMENT_TIMEOUT = 10000; // 10 seconds max for angular moves

// Forward declarations
void cancelAngularMovement();
void homeTurret();
void stopAllMotion();

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
  upLimitHit = digitalRead(UP_LIMIT_PIN) == LOW;
}

void IRAM_ATTR downLimitISR()
{
  downLimitHit = digitalRead(DOWN_LIMIT_PIN) == LOW;
}

bool canMoveUp()
{
  return !upLimitHit;
}

bool canMoveDown()
{
  return !downLimitHit;
}

bool isHomeSensorActive()
{
  return digitalRead(H_HOME_PIN) == LOW;
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

bool canMoveHorizontallyWithSpeed(float speed)
{
  // With slip ring installed, yaw can rotate continuously; no soft stops
  return true;
}

void stopAllMotion()
{
  horizontalStepper.setSpeed(0);
  verticalStepper.setSpeed(0);
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
  Serial.println("Starting burst fire mode (3 shots in 1.5 seconds)");
}

void updateBurstFire()
{
  if (!inBurstMode)
    return;

  unsigned long currentTime = millis();

  // Check if we can fire the next shot (trigger must be ready)
  if (burstShotCount < 3 && !triggerActive && currentTime >= nextBurstShotTime)
  {
    Serial.printf("Firing burst shot %d/3\n", burstShotCount + 1);
    startTriggerPull();
    burstShotCount++;

    // Schedule next shot 500ms later
    nextBurstShotTime = currentTime + 500;
  }

  // End burst mode after 1.5 seconds or all shots fired
  unsigned long elapsedTime = currentTime - burstStartTime;
  if (elapsedTime >= 1500 || burstShotCount >= 3)
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
    horizontalStepper.setSpeed(-maxStepsPerSec * 0.15);
    while (isHomeSensorActive())
    {
      horizontalStepper.runSpeed();
      if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
      {
        Serial.println("Timeout while backing off home sensor");
        horizontalStepper.setSpeed(0);
        return false;
      }
      delay(1);
    }
    horizontalStepper.setSpeed(0);
    homeSensorTriggered = false;
    delay(150);
  }

  const long searchStartPosition = horizontalStepper.currentPosition();
  const long maxSearchSteps = (long)(HORIZONTAL_FULL_ROTATION_STEPS * 1.5); // Up to 1.5 revolutions
  const float searchSpeed = maxStepsPerSec * calibrationSpeedFactor;
  bool homeFound = false;

  Serial.println("Sweeping yaw to find home sensor...");
  horizontalStepper.setSpeed(searchSpeed);
  while (labs(horizontalStepper.currentPosition() - searchStartPosition) < maxSearchSteps)
  {
    horizontalStepper.runSpeed();
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
  horizontalStepper.setSpeed(0);

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

  // If we're already at down limit, move away first
  if (downLimitHit)
  {
    Serial.println("Already at down limit, moving away...");
    verticalStepper.setSpeed(maxStepsPerSec * 0.2);
    while (downLimitHit)
    {
      verticalStepper.runSpeed();
      delay(1);
    }
    verticalStepper.setSpeed(0);
    delay(100);
  }

  // Move down until limit switch is hit
  Serial.println("Moving to down limit...");
  verticalStepper.setSpeed(-maxStepsPerSec * calibrationSpeedFactor);
  long downSearchStart = verticalStepper.currentPosition();
  while (canMoveDown() && labs(verticalStepper.currentPosition() - downSearchStart) < maxVerticalSearchSteps)
  {
    verticalStepper.runSpeed();
    if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
    {
      Serial.println("Timeout while searching for down limit");
      verticalStepper.setSpeed(0);
      break;
    }
    delay(1);
  }
  downLimitPosition = verticalStepper.currentPosition();
  verticalStepper.setSpeed(0);
  downFound = !canMoveDown();
  Serial.printf("Down limit found at position: %ld\n", downLimitPosition);

  // Move away from down limit a bit
  verticalStepper.move(100);
  while (verticalStepper.distanceToGo() != 0)
  {
    verticalStepper.run();
  }

  // If we're already at up limit, move away first
  if (upLimitHit)
  {
    Serial.println("Already at up limit, moving away...");
    verticalStepper.setSpeed(-maxStepsPerSec * 0.2);
    while (upLimitHit)
    {
      verticalStepper.runSpeed();
      delay(1);
    }
    verticalStepper.setSpeed(0);
    delay(100);
  }

  // Move up until limit switch is hit
  Serial.println("Moving to up limit...");
  verticalStepper.setSpeed(maxStepsPerSec * calibrationSpeedFactor);
  long upSearchStart = verticalStepper.currentPosition();
  while (canMoveUp() && labs(verticalStepper.currentPosition() - upSearchStart) < maxVerticalSearchSteps)
  {
    verticalStepper.runSpeed();
    if (millis() - startTime > CALIBRATION_TIMEOUT_MS)
    {
      Serial.println("Timeout while searching for up limit");
      verticalStepper.setSpeed(0);
      break;
    }
    delay(1);
  }
  upLimitPosition = verticalStepper.currentPosition();
  verticalStepper.setSpeed(0);
  upFound = !canMoveUp();
  Serial.printf("Up limit found at position: %ld\n", upLimitPosition);

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
    Serial.println("Vertical calibration complete!");
    Serial.printf("Vertical working range: %ld to %ld steps (%ld total)\n",
                  downLimitPosition, upLimitPosition,
                  upLimitPosition - downLimitPosition);
    return true;
  }

  isVerticalCalibrated = false;
  Serial.println("WARNING: Vertical calibration incomplete - limit switches not detected as expected");
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

  // Notify any connected clients
  StaticJsonDocument<128> response;
  response["calibrationComplete"] = angularPositioningEnabled;
  response["yawHomed"] = horizontalOk;
  response["tiltCalibrated"] = verticalOk;
  String responseStr;
  serializeJson(response, responseStr);
  if (ws.count() > 0)
  {
    ws.textAll(responseStr);
  }
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
    return false;
  }

  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    return false;
  }

  // Horizontal (yaw) with slip ring: wrap target to 0-360 and take shortest path
  float currentHorizontalAngle = wrapTo360(stepsToDegrees(horizontalStepper.currentPosition() - horizontalCenterPosition, true));
  float targetHorizontalAngle = wrapTo360(horizontalDegrees);
  float horizontalDelta = shortestDeltaDegrees(currentHorizontalAngle, targetHorizontalAngle);
  long targetHorizontalPosition = horizontalStepper.currentPosition() + degreesToSteps(horizontalDelta, true);

  long targetVerticalPosition = verticalCenterPosition + degreesToSteps(verticalDegrees, false);

  // Check if targets are within limits
  if (targetVerticalPosition < downLimitPosition || targetVerticalPosition > upLimitPosition)
  {
    Serial.printf("Vertical target %.2f° (pos %ld) exceeds limits [%ld, %ld]\n",
                  verticalDegrees, targetVerticalPosition, downLimitPosition, upLimitPosition);
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
    return false;
  }

  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    return false;
  }

  // Calculate relative movement in steps
  long horizontalSteps = degreesToSteps(horizontalDegrees, true);
  long verticalSteps = degreesToSteps(verticalDegrees, false);

  // Calculate target positions
  long targetHorizontalPosition = horizontalStepper.currentPosition() + horizontalSteps;
  long targetVerticalPosition = verticalStepper.currentPosition() + verticalSteps;

  // Check if targets are within limits (tilt only)
  if (targetVerticalPosition < downLimitPosition || targetVerticalPosition > upLimitPosition)
  {
    Serial.printf("Relative vertical move %.2f° would exceed limits\n", verticalDegrees);
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

    // Check if angular movement is in progress
    if (angularMovementInProgress)
    {
      // Check for timeout to prevent getting stuck
      unsigned long currentTime = millis();
      if (currentTime - angularMovementStartTime > ANGULAR_MOVEMENT_TIMEOUT)
      {
        Serial.println("Angular movement timeout - resuming joystick control");
        angularMovementInProgress = false;
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
    float currentHorizontalSpeed = 0.0;
    float currentVerticalSpeed = 0.0;

    // Handle horizontal movement (X-axis)
    if (fabs(currentX) > deadzone)
    {
      float normX = (fabs(currentX) - deadzone) / (1.0 - deadzone);
      float mappedSpeed = pow(normX, speedExponent) * effectiveMaxStepsPerSec;

      // Check yaw soft limits before setting speed
      if (currentX > 0)
      {
        if (canMoveHorizontallyWithSpeed(mappedSpeed))
        {
          currentHorizontalSpeed = mappedSpeed;
          horizontalStepper.setSpeed(currentHorizontalSpeed);
        }
        else
        {
          horizontalStepper.setSpeed(0);
          currentHorizontalSpeed = 0;
        }
      }
      else if (currentX < 0)
      {
        if (canMoveHorizontallyWithSpeed(-mappedSpeed))
        {
          currentHorizontalSpeed = -mappedSpeed;
          horizontalStepper.setSpeed(currentHorizontalSpeed);
        }
        else
        {
          horizontalStepper.setSpeed(0);
          currentHorizontalSpeed = 0;
        }
      }
      else
      {
        // Hit a soft limit or trying to move into one
        horizontalStepper.setSpeed(0);
        currentHorizontalSpeed = 0;
      }
    }
    else
    {
      horizontalStepper.setSpeed(0);
      currentHorizontalSpeed = 0;
    }

    // Handle vertical movement (Y-axis)
    if (fabs(currentY) > deadzone)
    {
      float normY = (fabs(currentY) - deadzone) / (1.0 - deadzone);
      float mappedSpeed = pow(normY, speedExponent) * effectiveMaxStepsPerSec;

      // Check limit switches before setting speed
      if (currentY > 0 && canMoveUp())
      { // Moving up
        currentVerticalSpeed = mappedSpeed;
        verticalStepper.setSpeed(currentVerticalSpeed);
      }
      else if (currentY < 0 && canMoveDown())
      { // Moving down
        currentVerticalSpeed = -mappedSpeed;
        verticalStepper.setSpeed(currentVerticalSpeed);
      }
      else
      {
        // Hit a limit switch or trying to move into a limit
        verticalStepper.setSpeed(0);
        currentVerticalSpeed = 0;
      }
    }
    else
    {
      verticalStepper.setSpeed(0);
      currentVerticalSpeed = 0;
    }

    // Run both steppers using runSpeed() for joystick control
    horizontalStepper.runSpeed();
    verticalStepper.runSpeed();

    // Log the status every 500ms to avoid flooding the serial monitor
    unsigned long currentMillis = millis();
    if (currentMillis - lastLogTime >= 500)
    {
      lastLogTime = currentMillis;
      float horizontalPercentSpeed = (fabs(currentHorizontalSpeed) / effectiveMaxStepsPerSec) * 100.0;
      float verticalPercentSpeed = (fabs(currentVerticalSpeed) / effectiveMaxStepsPerSec) * 100.0;
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
    break;
  case WS_EVT_DISCONNECT:
    Serial.printf("WebSocket client disconnected: %u\n", client->id());
    break;
  case WS_EVT_DATA:
  {
    StaticJsonDocument<200> doc;
    DeserializationError error = deserializeJson(doc, data, len);
    if (error)
    {
      Serial.print("deserializeJson() failed: ");
      Serial.println(error.c_str());
      return;
    }
    if (doc.containsKey("x"))
    {
      joystickX = doc["x"].as<float>();
      Serial.printf("WebSocket X received: %.3f\n", joystickX);

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
      Serial.printf("WebSocket Y received: %.3f\n", joystickY);

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

  // Setup sensor pins with internal pull-up resistors
  pinMode(H_HOME_PIN, INPUT_PULLUP);
  pinMode(UP_LIMIT_PIN, INPUT_PULLUP);
  pinMode(DOWN_LIMIT_PIN, INPUT_PULLUP);

  // Attach interrupts for sensors
  attachInterrupt(digitalPinToInterrupt(H_HOME_PIN), homeSensorISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(UP_LIMIT_PIN), upLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(DOWN_LIMIT_PIN), downLimitISR, CHANGE);

  // Initialize sensor states
  homeSensorTriggered = digitalRead(H_HOME_PIN) == LOW;
  upLimitHit = digitalRead(UP_LIMIT_PIN) == LOW;
  downLimitHit = digitalRead(DOWN_LIMIT_PIN) == LOW;

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
  horizontalStepper.setMaxSpeed(effectiveMaxStepsPerSec);
  verticalStepper.setMaxSpeed(effectiveMaxStepsPerSec);
  horizontalStepper.setAcceleration(effectiveMaxStepsPerSec * 0.8);
  verticalStepper.setAcceleration(effectiveMaxStepsPerSec * 0.8);

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
  Serial.println("  - {\"fire\": \"burst\"} - Fire 3-shot burst");
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
  }
}
