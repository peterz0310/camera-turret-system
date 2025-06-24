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

// Stepper motor settings
const int STEP_PIN = 26;
const int DIR_PIN = 25;
const int LEFT_LIMIT_PIN = 32;
const int RIGHT_LIMIT_PIN = 33;
const int microstepFactor = 2;
const int baseMaxStepsPerSec = 1000;
const int maxStepsPerSec = baseMaxStepsPerSec * microstepFactor;
const float deadzone = 0.1;

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

// Limit switch variables
volatile bool leftLimitHit = false;
volatile bool rightLimitHit = false;
bool isCalibrated = false;
long leftLimitPosition = 0;
long rightLimitPosition = 0;

// Global joystick values (updated via WebSocket)
volatile float joystickX = 0.0;
volatile float joystickY = 0.0;

// Create an AccelStepper instance
AccelStepper stepper(AccelStepper::DRIVER, STEP_PIN, DIR_PIN);

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

bool canMoveLeft()
{
  return !leftLimitHit;
}

bool canMoveRight()
{
  return !rightLimitHit;
}

// Trigger control functions
void pullTrigger()
{
  triggerServo.write(SERVO_FIRE_ANGLE);
  delay(TRIGGER_DELAY_MS);
  triggerServo.write(SERVO_REST_ANGLE);
  delay(50); // Small delay to ensure servo reaches rest position
}

void fireSingleShot()
{
  if (triggerActive)
  {
    Serial.println("Trigger already active - ignoring single shot command");
    return;
  }

  triggerActive = true;
  Serial.println("Firing single shot");
  pullTrigger();
  triggerActive = false;
  Serial.println("Single shot complete");
}

void startBurstFire()
{
  if (triggerActive)
  {
    Serial.println("Trigger already active - ignoring burst fire command");
    return;
  }

  triggerActive = true;
  inBurstMode = true;
  burstShotCount = 0;
  burstStartTime = millis();
  Serial.println("Starting burst fire mode (3 shots in 1.5 seconds)");
}

void updateBurstFire()
{
  if (!inBurstMode || !triggerActive)
    return;

  unsigned long currentTime = millis();
  unsigned long elapsedTime = currentTime - burstStartTime;

  // Calculate when each shot should fire (spread over 1.5 seconds)
  // Shot 1: 0ms, Shot 2: 500ms, Shot 3: 1000ms
  unsigned long shotTimes[] = {0, 500, 1000};

  if (burstShotCount < 3)
  {
    if (elapsedTime >= shotTimes[burstShotCount])
    {
      Serial.printf("Firing burst shot %d/3\n", burstShotCount + 1);
      pullTrigger();
      burstShotCount++;
    }
  }

  // End burst mode after 1.5 seconds or all shots fired
  if (elapsedTime >= 1500 || burstShotCount >= 3)
  {
    inBurstMode = false;
    triggerActive = false;
    Serial.println("Burst fire complete");
  }
}

// Calibration function - moves to both limits to establish working range
void calibrateMotor()
{
  Serial.println("Starting motor calibration...");

  // Move left until limit switch is hit
  Serial.println("Moving to left limit...");
  stepper.setSpeed(-maxStepsPerSec * 0.3);
  while (canMoveLeft())
  {
    stepper.runSpeed();
    delay(1);
  }
  leftLimitPosition = stepper.currentPosition();
  stepper.setSpeed(0);
  Serial.printf("Left limit found at position: %ld\n", leftLimitPosition);

  // Move away from left limit a bit
  stepper.move(100);
  while (stepper.distanceToGo() != 0)
  {
    stepper.run();
  }

  // Move right until limit switch is hit
  Serial.println("Moving to right limit...");
  stepper.setSpeed(maxStepsPerSec * 0.3);
  while (canMoveRight())
  {
    stepper.runSpeed();
    delay(1);
  }
  rightLimitPosition = stepper.currentPosition();
  stepper.setSpeed(0);
  Serial.printf("Right limit found at position: %ld\n", rightLimitPosition);

  // Move to center
  long centerPosition = (leftLimitPosition + rightLimitPosition) / 2;
  stepper.moveTo(centerPosition);
  while (stepper.distanceToGo() != 0)
  {
    stepper.run();
  }

  isCalibrated = true;
  Serial.println("Calibration complete!");
  Serial.printf("Working range: %ld to %ld steps (%ld total)\n",
                leftLimitPosition, rightLimitPosition,
                rightLimitPosition - leftLimitPosition);
}

void motorTask(void *parameter)
{
  // Used to throttle logging frequency
  unsigned long lastLogTime = 0;

  for (;;)
  {
    // Handle burst fire timing
    updateBurstFire();

    float currentX = joystickX;
    float currentY = joystickY;
    float currentSpeed = 0.0;

    if (fabs(currentX) > deadzone)
    {
      float normX = (fabs(currentX) - deadzone) / (1.0 - deadzone);
      float exponent = 2.0;
      float mappedSpeed = pow(normX, exponent) * maxStepsPerSec;

      // Check limit switches before setting speed
      if (currentX > 0 && canMoveRight())
      { // Moving right
        currentSpeed = mappedSpeed;
        stepper.setSpeed(currentSpeed);
      }
      else if (currentX < 0 && canMoveLeft())
      { // Moving left
        currentSpeed = -mappedSpeed;
        stepper.setSpeed(currentSpeed);
      }
      else
      {
        // Hit a limit switch or trying to move into a limit
        stepper.setSpeed(0);
        currentSpeed = 0;
        if ((currentX > 0 && !canMoveRight()) || (currentX < 0 && !canMoveLeft()))
        {
          // Only log limit hit occasionally to avoid spam
          if (millis() - lastLogTime >= 1000)
          {
            Serial.println("Limit switch hit - movement blocked");
          }
        }
      }
    }
    else
    {
      stepper.setSpeed(0);
      currentSpeed = 0;
    }

    stepper.runSpeed();

    // Log the percent speed every 500ms to avoid flooding the serial monitor
    unsigned long currentMillis = millis();
    if (currentMillis - lastLogTime >= 500)
    {
      lastLogTime = currentMillis;
      float percentSpeed = (fabs(currentSpeed) / maxStepsPerSec) * 100.0;
      Serial.printf("Motor speed: %.2f%% | Limits: L=%s R=%s | Pos: %ld | Trigger: %s\n",
                    percentSpeed,
                    leftLimitHit ? "HIT" : "OK",
                    rightLimitHit ? "HIT" : "OK",
                    stepper.currentPosition(),
                    triggerActive ? "ACTIVE" : "READY");
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
      joystickX = doc["x"].as<float>();
    if (doc.containsKey("y"))
      joystickY = doc["y"].as<float>();

    // Check for calibration command
    if (doc.containsKey("calibrate") && doc["calibrate"].as<bool>())
    {
      Serial.println("Calibration requested via WebSocket");
      calibrateMotor();
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

  // Attach interrupts for limit switches
  attachInterrupt(digitalPinToInterrupt(LEFT_LIMIT_PIN), leftLimitISR, CHANGE);
  attachInterrupt(digitalPinToInterrupt(RIGHT_LIMIT_PIN), rightLimitISR, CHANGE);

  // Initialize limit switch states
  leftLimitHit = digitalRead(LEFT_LIMIT_PIN) == LOW;
  rightLimitHit = digitalRead(RIGHT_LIMIT_PIN) == LOW;

  Serial.printf("Initial limit switch states - Left: %s, Right: %s\n",
                leftLimitHit ? "HIT" : "OK", rightLimitHit ? "HIT" : "OK");

  // Initialize stepper settings
  stepper.setMaxSpeed(maxStepsPerSec);

  // Initialize servo motor for trigger
  triggerServo.attach(SERVO_PIN);
  triggerServo.write(SERVO_REST_ANGLE); // Set to rest position
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
