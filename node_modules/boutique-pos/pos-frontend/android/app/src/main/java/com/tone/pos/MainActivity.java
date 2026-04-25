package com.tone.pos;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Register local (in-app) Capacitor plugins BEFORE BridgeActivity creates the Bridge.
    registerPlugin(BluetoothEscposPlugin.class);

    super.onCreate(savedInstanceState);
  }
}
