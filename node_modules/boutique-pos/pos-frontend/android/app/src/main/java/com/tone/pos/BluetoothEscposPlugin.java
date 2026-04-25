package com.tone.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
  name = "BluetoothEscpos",
  permissions = {
    @Permission(alias = "bluetooth_connect", strings = {Manifest.permission.BLUETOOTH_CONNECT})
  }
)
public class BluetoothEscposPlugin extends Plugin {
  // Bluetooth Classic SPP UUID used by most ESC/POS printers.
  private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

  private BluetoothSocket socket = null;
  private OutputStream output = null;
  private String connectedAddress = null;

  private boolean needsConnectPermission() {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
  }

  private boolean hasConnectPermission() {
    if (!needsConnectPermission()) return true;
    PermissionState state = getPermissionState("bluetooth_connect");
    return state != null && state == PermissionState.GRANTED;
  }

  private BluetoothAdapter getAdapterOrReject(PluginCall call) {
    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
    if (adapter == null) {
      call.reject("Bluetooth not supported on this device");
      return null;
    }
    if (!adapter.isEnabled()) {
      call.reject("Bluetooth is disabled. Enable Bluetooth and try again.");
      return null;
    }
    return adapter;
  }

  private void closeSocketQuietly() {
    try {
      if (output != null) output.close();
    } catch (Exception ignored) {
    }
    try {
      if (socket != null) socket.close();
    } catch (Exception ignored) {
    }
    output = null;
    socket = null;
    connectedAddress = null;
  }

  @PluginMethod
  public void requestPermission(PluginCall call) {
    if (!needsConnectPermission()) {
      JSObject ret = new JSObject();
      ret.put("granted", true);
      call.resolve(ret);
      return;
    }

    if (hasConnectPermission()) {
      JSObject ret = new JSObject();
      ret.put("granted", true);
      call.resolve(ret);
      return;
    }

    requestPermissionForAlias("bluetooth_connect", call, "permissionCallback");
  }

  @PermissionCallback
  private void permissionCallback(PluginCall call) {
    if (!hasConnectPermission()) {
      call.reject("Bluetooth permission denied");
      return;
    }

    // If the permission prompt was initiated by requestPermission, resolve it.
    if ("requestPermission".equals(call.getMethodName())) {
      JSObject ret = new JSObject();
      ret.put("granted", true);
      call.resolve(ret);
      return;
    }

    // Otherwise retry the original call (Capacitor keeps methodName on the call).
    String method = call.getMethodName();
    if ("listPairedDevices".equals(method)) {
      listPairedDevices(call);
      return;
    }
    if ("connect".equals(method)) {
      connect(call);
      return;
    }
    if ("print".equals(method)) {
      print(call);
      return;
    }

    call.resolve();
  }

  @PluginMethod
  public void listPairedDevices(PluginCall call) {
    if (!hasConnectPermission()) {
      requestPermissionForAlias("bluetooth_connect", call, "permissionCallback");
      return;
    }

    BluetoothAdapter adapter = getAdapterOrReject(call);
    if (adapter == null) return;

    Set<BluetoothDevice> devices = adapter.getBondedDevices();
    JSArray arr = new JSArray();

    if (devices != null) {
      for (BluetoothDevice d : devices) {
        JSObject o = new JSObject();
        o.put("name", d.getName());
        o.put("address", d.getAddress());
        arr.put(o);
      }
    }

    JSObject ret = new JSObject();
    ret.put("devices", arr);
    call.resolve(ret);
  }

  @PluginMethod
  public void connect(PluginCall call) {
    if (!hasConnectPermission()) {
      requestPermissionForAlias("bluetooth_connect", call, "permissionCallback");
      return;
    }

    final String address = call.getString("address", "");
    if (address == null || address.trim().isEmpty()) {
      call.reject("Printer address is required");
      return;
    }

    final BluetoothAdapter adapter = getAdapterOrReject(call);
    if (adapter == null) return;

    execute(
      () -> {
        try {
          // Reset any existing connection.
          closeSocketQuietly();

          BluetoothDevice device = adapter.getRemoteDevice(address);

          BluetoothSocket s = null;
          try {
            s = device.createRfcommSocketToServiceRecord(SPP_UUID);
            try {
              // cancelDiscovery() requires BLUETOOTH_SCAN on Android 12+, but we don't need scanning for paired printers.
              adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
            }
            s.connect();
          } catch (Exception e) {
            try {
              if (s != null) s.close();
            } catch (Exception ignored) {
            }

            // Some printers require an insecure RFCOMM socket.
            s = device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
            try {
              adapter.cancelDiscovery();
            } catch (SecurityException ignored) {
            }
            s.connect();
          }

          OutputStream os = s.getOutputStream();

          socket = s;
          output = os;
          connectedAddress = address;

          JSObject ret = new JSObject();
          ret.put("address", address);
          call.resolve(ret);
        } catch (Exception e) {
          closeSocketQuietly();
          call.reject("Failed to connect to printer: " + e.getMessage());
        }
      }
    );
  }

  @PluginMethod
  public void disconnect(PluginCall call) {
    execute(
      () -> {
        closeSocketQuietly();
        call.resolve();
      }
    );
  }

  @PluginMethod
  public void isConnected(PluginCall call) {
    JSObject ret = new JSObject();
    ret.put("connected", socket != null && output != null && socket.isConnected());
    ret.put("address", connectedAddress);
    call.resolve(ret);
  }

  @PluginMethod
  public void print(PluginCall call) {
    if (!hasConnectPermission()) {
      requestPermissionForAlias("bluetooth_connect", call, "permissionCallback");
      return;
    }

    final String text = call.getString("text", "");
    if (text == null || text.isEmpty()) {
      call.reject("Text is required");
      return;
    }

    final String encoding = call.getString("encoding", "UTF-8");
    final Integer feedLinesRaw = call.getInt("feedLines");
    final int feedLines = Math.max(0, feedLinesRaw == null ? 4 : feedLinesRaw);
    final Boolean initializeRaw = call.getBoolean("initialize");
    final boolean initialize = initializeRaw == null ? true : initializeRaw;
    final Boolean cutRaw = call.getBoolean("cut");
    final boolean cut = cutRaw != null && cutRaw;

    execute(
      () -> {
        try {
          if (socket == null || output == null || !socket.isConnected()) {
            call.reject("Not connected to a printer");
            return;
          }

          if (initialize) {
            output.write(new byte[]{0x1B, 0x40}); // ESC @ init
          }

          byte[] bytes = text.getBytes(Charset.forName(encoding));
          output.write(bytes);

          for (int i = 0; i < feedLines; i++) {
            output.write(0x0A); // LF
          }

          if (cut) {
            // Many portable printers don't have a cutter; keep optional.
            output.write(new byte[]{0x1D, 0x56, 0x42, 0x00}); // GS V B 0
          }

          output.flush();
          call.resolve();
        } catch (Exception e) {
          call.reject("Failed to print: " + e.getMessage());
        }
      }
    );
  }
}
