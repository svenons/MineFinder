#!/bin/bash

set -e

echo "### PlatformIO Firmware Build ###"

# Clean up previous release
echo "Cleaning up previous Builds..."
rm -rf "./build"

# Build fw
echo "Creating Folders..."
mkdir "build"

echo "Building debug Version..."
platformio run --environment debug
if [[ -f ".pio/build/debug/firmware.bin" ]]; then
  cp ".pio/build/debug/firmware.bin" "./build/debug.bin"
elif [[ -f ".pio/build/debug/firmware.hex" ]]; then
  cp ".pio/build/debug/firmware.hex" "./build/debug.hex"
else 
  echo "Debug Build not found bin .pio/build/debug"
fi 

echo "Building release Version..."
platformio run --environment release
if [[ -f ".pio/build/release/firmware.bin" ]]; then
  cp ".pio/build/release/firmware.bin" "./build/release.bin"
elif [[ -f ".pio/build/release/firmware.hex" ]]; then
  cp ".pio/build/release/firmware.hex" "./build/release.hex"
else 
  echo "Release Build not found bin .pio/build/release"
fi 

echo "Firmware Builds completed."