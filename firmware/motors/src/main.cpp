#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <AccelStepper.h>

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

// Calibration function - moves to both limits to establish working range
void calibrateMotor()
{
  Serial.println("Starting motor calibration...");

  // Move left until limit switch is hit
  Serial.println("Moving to left limit...");
  stepper.setSpeed(-maxStepsPerSec * 0.3); // Slow speed for calibration
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
    float currentX = joystickX;
    float currentY = joystickY;
    float currentSpeed = 0.0;

    if (fabs(currentX) > deadzone)
    {
      float normX = (fabs(currentX) - deadzone) / (1.0 - deadzone);
      float exponent = 2.0; // scaling
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
      Serial.printf("Motor speed: %.2f%% | Limits: L=%s R=%s | Pos: %ld\n",
                    percentSpeed,
                    leftLimitHit ? "HIT" : "OK",
                    rightLimitHit ? "HIT" : "OK",
                    stepper.currentPosition());
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

  Serial.println("System ready! Send {\"calibrate\": true} via WebSocket to calibrate limits.");
}

void loop()
{
  // Main loop can handle network operations, etc.
  // Keeping it lightweight to avoid interference
  yield();
}
