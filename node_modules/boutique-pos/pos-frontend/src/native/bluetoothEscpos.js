import { Capacitor, registerPlugin } from "@capacitor/core";

// Local (in-app) Capacitor plugin implemented in:
// pos-frontend/android/app/src/main/java/com/tone/pos/BluetoothEscposPlugin.java
const BluetoothEscpos = registerPlugin("BluetoothEscpos");

export const BT_PRINTER_ADDRESS_KEY = "tone_bt_printer_address";

export function isNativeAndroid() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function requestBluetoothPermission() {
  if (!isNativeAndroid()) return { granted: false };
  return BluetoothEscpos.requestPermission();
}

export async function listPairedPrinters() {
  if (!isNativeAndroid()) return { devices: [] };
  return BluetoothEscpos.listPairedDevices();
}

export async function connectPrinter(address) {
  if (!isNativeAndroid()) throw new Error("Bluetooth printer is only available in the Android app.");
  return BluetoothEscpos.connect({ address });
}

export async function disconnectPrinter() {
  if (!isNativeAndroid()) return;
  return BluetoothEscpos.disconnect();
}

export async function printText(text, opts = {}) {
  if (!isNativeAndroid()) throw new Error("Bluetooth printing is only available in the Android app.");
  const payload = {
    text,
    encoding: opts.encoding || "UTF-8",
    feedLines: Number.isFinite(opts.feedLines) ? opts.feedLines : 4,
    initialize: opts.initialize !== false,
    cut: Boolean(opts.cut),
  };
  return BluetoothEscpos.print(payload);
}

