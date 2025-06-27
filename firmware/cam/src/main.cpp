#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include "esp_camera.h"

const char *ssid = "Apt 210";
const char *password = "mistycanoe3";

// Camera pin definition for AI Thinker model
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

WebServer server(80);

// Boundary for multipart stream
const char *STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=frame";
const char *FRAME_BOUNDARY = "\r\n--frame\r\n";
const char *FRAME_CONTENT_TYPE = "Content-Type: image/jpeg\r\n\r\n";

void handleJPGStream()
{
  WiFiClient client = server.client();
  if (!client.connected())
  {
    Serial.println("Client disconnected before stream could start.");
    return;
  }

  // Send the initial HTTP header for the MJPEG stream
  String response = "HTTP/1.1 200 OK\r\n";
  response += "Content-Type: " + String(STREAM_CONTENT_TYPE) + "\r\n";
  response += "Access-Control-Allow-Origin: *\r\n";
  response += "Connection: close\r\n\r\n"; // Close connection when client is done

  server.sendContent(response);

  Serial.println("Started streaming to client.");

  while (client.connected())
  {
    camera_fb_t *fb = esp_camera_fb_get();
    if (!fb)
    {
      Serial.println("Camera capture failed");
      // A short delay to prevent a tight loop of failures
      delay(100);
      continue;
    }

    // Write the frame boundary and content type directly to the client
    client.write(FRAME_BOUNDARY, strlen(FRAME_BOUNDARY));
    client.write(FRAME_CONTENT_TYPE, strlen(FRAME_CONTENT_TYPE));

    // Write the JPEG image data
    client.write(fb->buf, fb->len);

    // Return the frame buffer to be reused
    esp_camera_fb_return(fb);
  }

  Serial.println("Client disconnected.");
}

void handleRoot()
{
  server.send(200, "text/html", "<!DOCTYPE html><html><head><title>ESP32 Cam</title></head><body><h1>ESP32 Cam</h1><img src=\"/stream\" style=\"width:640px; height:480px;\"></body></html>");
}

void startCameraServer()
{
  server.on("/", HTTP_GET, handleRoot);
  server.on("/stream", HTTP_GET, handleJPGStream);
  server.begin();
  Serial.println("HTTP server started.");
}

void setup()
{
  Serial.begin(115200);
  Serial.setDebugOutput(true);
  Serial.println();
  Serial.println("ESP32 AI Turret Cam Starting...");

  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_JPEG;

  config.frame_size = FRAMESIZE_HVGA;
  config.jpeg_quality = 20;
  config.fb_count = 3;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.grab_mode = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK)
  {
    Serial.printf("Camera init failed with error 0x%x", err);
    return;
  }

  // Wait a moment for the camera to stabilize
  delay(1000);

  sensor_t *s = esp_camera_sensor_get();
  if (s)
  {
    Serial.println("Configuring camera sensor settings...");

    // Apply correct orientation settings - Mode 0 works for this camera
    Serial.println("Applying camera orientation settings...");
    Serial.println("Using Mode 0: Normal orientation (no flip, no mirror)");

    s->set_vflip(s, 0);
    s->set_hmirror(s, 0);
    delay(100);

    Serial.println("Camera orientation configured successfully");

    // Give sensor time to apply settings
    delay(500);

    // Apply other sensor settings
    s->set_brightness(s, 0);                 // -2 to 2
    s->set_contrast(s, 0);                   // -2 to 2
    s->set_saturation(s, 0);                 // -2 to 2
    s->set_special_effect(s, 0);             // 0-6 (0 - no effect)
    s->set_whitebal(s, 1);                   // 0 = disable, 1 = enable
    s->set_awb_gain(s, 1);                   // 0 = disable, 1 = enable
    s->set_wb_mode(s, 0);                    // 0-4 (0 - auto)
    s->set_exposure_ctrl(s, 1);              // 0 = disable, 1 = enable
    s->set_aec2(s, 0);                       // 0 = disable, 1 = enable
    s->set_ae_level(s, 0);                   // -2 to 2
    s->set_aec_value(s, 300);                // 0-1200
    s->set_gain_ctrl(s, 1);                  // 0 = disable, 1 = enable
    s->set_agc_gain(s, 0);                   // 0-30
    s->set_gainceiling(s, (gainceiling_t)0); // 0-6
    s->set_bpc(s, 0);                        // 0 = disable, 1 = enable
    s->set_wpc(s, 1);                        // 0 = disable, 1 = enable
    s->set_raw_gma(s, 1);                    // 0 = disable, 1 = enable
    s->set_lenc(s, 1);                       // 0 = disable, 1 = enable
    s->set_dcw(s, 1);                        // 0 = disable, 1 = enable
    s->set_colorbar(s, 0);                   // 0 = disable, 1 = enable

    Serial.println("Camera sensor configuration complete");
  }
  else
  {
    Serial.println("Error: Could not get camera sensor handle");
  }

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println("\nWiFi connected!");
  Serial.print("Camera Stream available at: http://");
  Serial.println(WiFi.localIP());

  startCameraServer();
}

// Function to test if camera orientation is working
bool testCameraOrientation()
{
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb)
  {
    esp_camera_fb_return(fb);
    return true;
  }
  return false;
}

void loop()
{
  server.handleClient();
}