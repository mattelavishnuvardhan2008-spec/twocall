package com.example.twocall

import android.content.Intent
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "CallConfig")
class CallConfigPlugin : Plugin() {

    @PluginMethod
    fun save(call: PluginCall) {
        context.getSharedPreferences("twocall", 0).edit()
            .putString("server", call.getString("server") ?: "")
            .putString("me", call.getString("me") ?: "")
            .putString("secret", call.getString("secret") ?: "")
            .apply()

        val i = Intent(context, CallService::class.java)
        context.stopService(i)
        ContextCompat.startForegroundService(context, i)
        call.resolve(JSObject())
    }
}