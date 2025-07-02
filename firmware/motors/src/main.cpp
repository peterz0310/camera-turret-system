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

// Horizontal stepper motor settings (left/right)
const int H_STEP_PIN = 26;
const int H_DIR_PIN = 25;
const int LEFT_LIMIT_PIN = 32;
const int RIGHT_LIMIT_PIN = 33;

// Vertical stepper motor settings (up/down - tilt)
const int V_STEP_PIN = 14;
const int V_DIR_PIN = 12;
const int UP_LIMIT_PIN = 4;
const int DOWN_LIMIT_PIN = 5;

const int microstepFactor = 2;
const int baseMaxStepsPerSec = 1000;
const int maxStepsPerSec = baseMaxStepsPerSec * microstepFactor;
const float deadzone = 0.1;

// Angular motion settings - configurable gear ratios and motor specs
const float HORIZONTAL_GEAR_RATIO = 8.0;  // 8:1 gear ratio for yaw
const float VERTICAL_GEAR_RATIO = 3.0;    // 3:1 gear ratio for tilt
const float STEPS_PER_REVOLUTION = 200.0; // Standard stepper motor (1.8° per step)
const float DEGREES_PER_REVOLUTION = 360.0;

// Calculate steps per degree for each axis (accounting for microstepping and gear ratios)
const float HORIZONTAL_STEPS_PER_DEGREE = (STEPS_PER_REVOLUTION * microstepFactor * HORIZONTAL_GEAR_RATIO) / DEGREES_PER_REVOLUTION;
const float VERTICAL_STEPS_PER_DEGREE = (STEPS_PER_REVOLUTION * microstepFactor * VERTICAL_GEAR_RATIO) / DEGREES_PER_REVOLUTION;

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
volatile bool leftLimitHit = false;
volatile bool rightLimitHit = false;
volatile bool upLimitHit = false;
volatile bool downLimitHit = false;
bool isHorizontalCalibrated = false;
bool isVerticalCalibrated = false;
long leftLimitPosition = 0;
long rightLimitPosition = 0;
long upLimitPosition = 0;
long downLimitPosition = 0;

// Global joystick values (updated via WebSocket)
volatile float joystickX = 0.0;
volatile float joystickY = 0.0;

// Create AccelStepper instances
AccelStepper horizontalStepper(AccelStepper::DRIVER, H_STEP_PIN, H_DIR_PIN);
AccelStepper verticalStepper(AccelStepper::DRIVER, V_STEP_PIN, V_DIR_PIN);

// Interrupt service routines for limit switches
// These functions are called INSTANTLY when limit switches change state
void IRAM_ATTR leftLimitISR()
{
  leftLimitHit = digitalRead(LEFT_LIMIT_PIN) == LOW;
}

void IRAM_ATTR rightLimitISR()
{
  rightLimitHit = digitalRead(RIGHT_LIMIT_PIN) == LOW;
}

void IRAM_ATTR upLimitISR()
{
  upLimitHit = digitalRead(UP_LIMIT_PIN) == LOW;
}

void IRAM_ATTR downLimitISR()
{
  downLimitHit = digitalRead(DOWN_LIMIT_PIN) == LOW;
}

bool canMoveLeft()
{
  return !leftLimitHit;
}

bool canMoveRight()
{
  return !rightLimitHit;
}

bool canMoveUp()
{
  return !upLimitHit;
}

bool canMoveDown()
{
  return !downLimitHit;
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
void calibrateHorizontalMotor()
{
  Serial.println("Starting horizontal motor calibration...");

  // Move left until limit switch is hit
  Serial.println("Moving to left limit...");
  horizontalStepper.setSpeed(-maxStepsPerSec * 0.3);
  while (canMoveLeft())
  {
    horizontalStepper.runSpeed();
    delay(1);
  }
  leftLimitPosition = horizontalStepper.currentPosition();
  horizontalStepper.setSpeed(0);
  Serial.printf("Left limit found at position: %ld\n", leftLimitPosition);

  // Move away from left limit a bit
  horizontalStepper.move(100);
  while (horizontalStepper.distanceToGo() != 0)
  {
    horizontalStepper.run();
  }

  // Move right until limit switch is hit
  Serial.println("Moving to right limit...");
  horizontalStepper.setSpeed(maxStepsPerSec * 0.3);
  while (canMoveRight())
  {
    horizontalStepper.runSpeed();
    delay(1);
  }
  rightLimitPosition = horizontalStepper.currentPosition();
  horizontalStepper.setSpeed(0);
  Serial.printf("Right limit found at position: %ld\n", rightLimitPosition);

  // Move to center
  long centerPosition = (leftLimitPosition + rightLimitPosition) / 2;
  horizontalStepper.moveTo(centerPosition);
  while (horizontalStepper.distanceToGo() != 0)
  {
    horizontalStepper.run();
  }

  isHorizontalCalibrated = true;
  Serial.println("Horizontal calibration complete!");
  Serial.printf("Horizontal working range: %ld to %ld steps (%ld total)\n",
                leftLimitPosition, rightLimitPosition,
                rightLimitPosition - leftLimitPosition);
}

void calibrateVerticalMotor()
{
  Serial.println("Starting vertical motor calibration...");

  // Move down until limit switch is hit
  Serial.println("Moving to down limit...");
  verticalStepper.setSpeed(-maxStepsPerSec * 0.3);
  while (canMoveDown())
  {
    verticalStepper.runSpeed();
    delay(1);
  }
  downLimitPosition = verticalStepper.currentPosition();
  verticalStepper.setSpeed(0);
  Serial.printf("Down limit found at position: %ld\n", downLimitPosition);

  // Move away from down limit a bit
  verticalStepper.move(100);
  while (verticalStepper.distanceToGo() != 0)
  {
    verticalStepper.run();
  }

  // Move up until limit switch is hit
  Serial.println("Moving to up limit...");
  verticalStepper.setSpeed(maxStepsPerSec * 0.3);
  while (canMoveUp())
  {
    verticalStepper.runSpeed();
    delay(1);
  }
  upLimitPosition = verticalStepper.currentPosition();
  verticalStepper.setSpeed(0);
  Serial.printf("Up limit found at position: %ld\n", upLimitPosition);

  // Move to center
  long centerPosition = (downLimitPosition + upLimitPosition) / 2;
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
}

void calibrateMotors()
{
  calibrateHorizontalMotor();
  calibrateVerticalMotor();

  // Set center positions for angular calculations
  horizontalCenterPosition = (leftLimitPosition + rightLimitPosition) / 2;
  verticalCenterPosition = (downLimitPosition + upLimitPosition) / 2;
  angularPositioningEnabled = true;

  Serial.println("All motors calibrated!");
  Serial.printf("Angular positioning enabled - Center positions: H=%ld, V=%ld\n",
                horizontalCenterPosition, verticalCenterPosition);
  Serial.printf("Steps per degree - Horizontal: %.2f, Vertical: %.2f\n",
                HORIZONTAL_STEPS_PER_DEGREE, VERTICAL_STEPS_PER_DEGREE);
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
  if (!angularPositioningEnabled)
  {
    Serial.println("Angular positioning not enabled - run calibration first");
    return false;
  }

  // Calculate target positions relative to center
  long targetHorizontalPosition = horizontalCenterPosition + degreesToSteps(horizontalDegrees, true);
  long targetVerticalPosition = verticalCenterPosition + degreesToSteps(verticalDegrees, false);

  // Check if targets are within limits
  if (targetHorizontalPosition < leftLimitPosition || targetHorizontalPosition > rightLimitPosition)
  {
    Serial.printf("Horizontal target %.2f° (pos %ld) exceeds limits [%ld, %ld]\n",
                  horizontalDegrees, targetHorizontalPosition, leftLimitPosition, rightLimitPosition);
    return false;
  }

  if (targetVerticalPosition < downLimitPosition || targetVerticalPosition > upLimitPosition)
  {
    Serial.printf("Vertical target %.2f° (pos %ld) exceeds limits [%ld, %ld]\n",
                  verticalDegrees, targetVerticalPosition, downLimitPosition, upLimitPosition);
    return false;
  }

  Serial.printf("Moving to absolute angles: H=%.2f° V=%.2f° (positions: H=%ld V=%ld)\n",
                horizontalDegrees, verticalDegrees, targetHorizontalPosition, targetVerticalPosition);

  horizontalStepper.moveTo(targetHorizontalPosition);
  verticalStepper.moveTo(targetVerticalPosition);

  return true;
}

bool moveByRelativeAngle(float horizontalDegrees, float verticalDegrees)
{
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

  // Check if targets are within limits
  if (targetHorizontalPosition < leftLimitPosition || targetHorizontalPosition > rightLimitPosition)
  {
    Serial.printf("Relative horizontal move %.2f° would exceed limits\n", horizontalDegrees);
    return false;
  }

  if (targetVerticalPosition < downLimitPosition || targetVerticalPosition > upLimitPosition)
  {
    Serial.printf("Relative vertical move %.2f° would exceed limits\n", verticalDegrees);
    return false;
  }

  Serial.printf("Moving by relative angles: H=%.2f° V=%.2f° (steps: H=%ld V=%ld)\n",
                horizontalDegrees, verticalDegrees, horizontalSteps, verticalSteps);

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

  horizontalAngle = stepsToDegrees(horizontalOffset, true);
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
    // Handle burst fire timing
    updateBurstFire();

    // Handle non-blocking trigger control
    updateTrigger();

    float currentX = joystickX;
    float currentY = joystickY;
    float currentHorizontalSpeed = 0.0;
    float currentVerticalSpeed = 0.0;

    // Handle horizontal movement (X-axis)
    if (fabs(currentX) > deadzone)
    {
      float normX = (fabs(currentX) - deadzone) / (1.0 - deadzone);
      float exponent = 2.0;
      float mappedSpeed = pow(normX, exponent) * maxStepsPerSec;

      // Check limit switches before setting speed
      if (currentX > 0 && canMoveRight())
      { // Moving right
        currentHorizontalSpeed = mappedSpeed;
        horizontalStepper.setSpeed(currentHorizontalSpeed);
      }
      else if (currentX < 0 && canMoveLeft())
      { // Moving left
        currentHorizontalSpeed = -mappedSpeed;
        horizontalStepper.setSpeed(currentHorizontalSpeed);
      }
      else
      {
        // Hit a limit switch or trying to move into a limit
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
      float exponent = 2.0;
      float mappedSpeed = pow(normY, exponent) * maxStepsPerSec;

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

    // Run both steppers
    horizontalStepper.runSpeed();
    verticalStepper.runSpeed();

    // Log the status every 500ms to avoid flooding the serial monitor
    unsigned long currentMillis = millis();
    if (currentMillis - lastLogTime >= 500)
    {
      lastLogTime = currentMillis;
      float horizontalPercentSpeed = (fabs(currentHorizontalSpeed) / maxStepsPerSec) * 100.0;
      float verticalPercentSpeed = (fabs(currentVerticalSpeed) / maxStepsPerSec) * 100.0;
      Serial.printf("Joy: X=%.3f Y=%.3f | H: %.1f%% V: %.1f%% | Limits: L=%s R=%s U=%s D=%s | H_Pos: %ld V_Pos: %ld | Trigger: %s | Cal: H=%s V=%s\n",
                    currentX, currentY,
                    horizontalPercentSpeed, verticalPercentSpeed,
                    leftLimitHit ? "HIT" : "OK",
                    rightLimitHit ? "HIT" : "OK",
                    upLimitHit ? "HIT" : "OK",
                    downLimitHit ? "HIT" : "OK",
                    horizontalStepper.currentPosition(),
                    verticalStepper.currentPosition(),
                    triggerActive ? "ACTIVE" : "READY",
                    isHorizontalCalibrated ? "YES" : "NO",
                    isVerticalCalibrated ? "YES" : "NO");
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
    }
    if (doc.containsKey("y"))
    {
      joystickY = doc["y"].as<float>();
      Serial.printf("WebSocket Y received: %.3f\n", joystickY);
    }

    // Check for calibration command
    if (doc.containsKey("calibrate") && doc["calibrate"].as<bool>())
    {
      Serial.println("Calibration requested via WebSocket");
      calibrateMotors();
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
      server.textAll(responseStr);

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

  // Setup limit switch pins with internal pull-up resistors
  pinMode(LEFT_LIMIT_PIN, INPUT_PULLUP);
  pinMode(RIGHT_LIMIT_PIN, INPUT_PULLUP);
  pinMode(UP_LIMIT_PIN, INPUT_PULLUP);
  pinMode(DOWN_LIMIT_PIN, INPUT_PULLUP);

  // Attach interrupts for limit switches
  attachInterrupt(digitalPinToInterrupt(LEFT_LIMIT_PIN), leftLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(RIGHT_LIMIT_PIN), rightLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(UP_LIMIT_PIN), upLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(DOWN_LIMIT_PIN), downLimitISR, CHANGE);

  // Initialize limit switch states
  leftLimitHit = digitalRead(LEFT_LIMIT_PIN) == LOW;
  rightLimitHit = digitalRead(RIGHT_LIMIT_PIN) == LOW;
  upLimitHit = digitalRead(UP_LIMIT_PIN) == LOW;
  downLimitHit = digitalRead(DOWN_LIMIT_PIN) == LOW;

  Serial.printf("Initial limit switch states - Left: %s, Right: %s, Up: %s, Down: %s\n",
                leftLimitHit ? "HIT" : "OK", rightLimitHit ? "HIT" : "OK",
                upLimitHit ? "HIT" : "OK", downLimitHit ? "HIT" : "OK");

  // Check for problematic vertical limit switch configuration
  if (upLimitHit && downLimitHit)
  {
    Serial.println("WARNING: Both vertical limit switches are triggered!");
    Serial.println("This may indicate a wiring issue or mechanical problem.");
    Serial.println("Check your UP_LIMIT_PIN (34) and DOWN_LIMIT_PIN (35) connections.");
  }

  // Initialize stepper settings
  horizontalStepper.setMaxSpeed(maxStepsPerSec);
  verticalStepper.setMaxSpeed(maxStepsPerSec);

  // Initialize servo motor for trigger
  triggerServo.setPeriodHertz(50);           // Standard 50Hz servo
  triggerServo.attach(SERVO_PIN, 500, 2500); // Min/Max pulse width in microseconds
  triggerServo.write(SERVO_REST_ANGLE);      // Set to rest position
  delay(500);                                // Give servo time to reach position
  Serial.println("Trigger servo initialized at rest position");

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
  Serial.println("  - {\"calibrate\": true} - Calibrate motor limits");
  Serial.println("  - {\"fire\": \"single\"} - Fire single shot");
  Serial.println("  - {\"fire\": \"burst\"} - Fire 3-shot burst");
  Serial.println("  - {\"x\": 0.5, \"y\": 0.0} - Control turret movement");
}

void loop()
{
  yield();
}
