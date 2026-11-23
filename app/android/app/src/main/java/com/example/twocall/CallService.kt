package com.example.twocall

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

class CallService : Service() {

    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private var socket: WebSocket? = null
    private val handler = Handler(Looper.getMainLooper())
    private var attempt = 0

    companion object {
        const val CH_ONGOING = "twocall_ongoing"
        const val CH_CALLS   = "twocall_calls"
        const val ID_ONGOING = 1
        const val ID_CALL    = 2
    }

    override fun onCreate() {
        super.onCreate()
        createChannels()
        startForegroundCompat()
        connect()
    }

    override fun onStartCommand(i: Intent?, f: Int, s: Int): Int {
        if (socket == null) connect()
        return START_STICKY
    }

    override fun onBind(i: Intent?): IBinder? = null

    private fun startForegroundCompat() {
        val n = NotificationCompat.Builder(this, CH_ONGOING)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("TwoCall")
            .setContentText("Ready for calls")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(
                ID_ONGOING, n,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else startForeground(ID_ONGOING, n)
    }

    private fun createChannels() {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(
                NotificationChannel(CH_ONGOING, "Service", NotificationManager.IMPORTANCE_MIN))
            nm.createNotificationChannel(
                NotificationChannel(CH_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
                    .apply { setBypassDnd(true); lockscreenVisibility = Notification.VISIBILITY_PUBLIC })
        }
    }

    private fun connect() {
        val sp = getSharedPreferences("twocall", 0)
        val server = sp.getString("server", "") ?: ""
        val me     = sp.getString("me", "") ?: ""
        val secret = sp.getString("secret", "") ?: ""
        if (server.isBlank() || me.isBlank()) {
            handler.postDelayed({ connect() }, 5000); return
        }
        val req = Request.Builder().url(server).build()
        socket = http.newWebSocket(req, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, r: Response) {
                attempt = 0
                ws.send(JSONObject().apply {
                    put("type", "register"); put("user", me); put("secret", secret)
                }.toString())
            }
            override fun onMessage(ws: WebSocket, text: String) {
                val o = try { JSONObject(text) } catch (e: Exception) { return }
                when (o.optString("type")) {
                    "call", "incoming" -> showIncoming(o.optString("from"))
                    "bye", "cancel"    -> getSystemService(NotificationManager::class.java).cancel(ID_CALL)
                }
            }
            override fun onFailure(ws: WebSocket, t: Throwable, r: Response?) {
                attempt++
                handler.postDelayed({ connect() }, minOf(30_000L, 2_000L * attempt))
            }
            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                handler.postDelayed({ connect() }, 3000)
            }
        })
    }

    private fun showIncoming(from: String) {
        val full = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 1, full,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(this, CH_CALLS)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle("Incoming call")
            .setContentText("$from is calling")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pi, true)
            .setAutoCancel(true)
            .setOngoing(true)
            .build()
        getSystemService(NotificationManager::class.java).notify(ID_CALL, n)
    }
}