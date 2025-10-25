#include <Arduino.h>
#include <IO_Pins.h>

void setup() {
    pinMode(STATUS_LED_PIN, OUTPUT);
}

void loop() {
#ifdef DEBUG
    digitalWrite(STATUS_LED_PIN, HIGH);
    delay(50);
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(50);
#endif
}