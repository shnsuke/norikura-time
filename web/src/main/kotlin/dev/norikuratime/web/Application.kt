package dev.norikuratime.web

import dev.norikuratime.core.ClimbPredictionService
import dev.norikuratime.core.CourseProfile
import dev.norikuratime.core.IntervalsIcuClient
import dev.norikuratime.core.RiderProfile
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.http.content.staticResources
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.calllogging.CallLogging
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.statuspages.StatusPages
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json

/**
 * 乗鞍ヒルクライム タイム予測アプリ の Webサーバー本体。
 *
 * :core (物理予測エンジン・コースプロフィール・intervals.icuクライアント) をそのまま利用し、
 * ブラウザ向けにHTTP API + 静的フロントエンドとして公開する。
 *
 * Web版では「Healthアプリからの自動体重取得」は行わない(ブラウザからは一般に
 * アクセスできないOS APIのため)。体重は画面からの手入力とする。
 */
fun main() {
    val port = System.getenv("PORT")?.toIntOrNull() ?: 8080
    embeddedServer(Netty, port = port, host = "0.0.0.0", module = Application::module).start(wait = true)
}

private fun loadCourse(): CourseProfile {
    val text = object {}.javaClass.getResourceAsStream("/courses/norikura_echo_line.json")
        ?.bufferedReader()?.use { it.readText() }
        ?: error("course asset not found: /courses/norikura_echo_line.json")
    return CourseProfile.parse(text)
}

fun Application.module() {
    val course = loadCourse()
    val predictionService = ClimbPredictionService()

    install(ContentNegotiation) {
        json(Json { ignoreUnknownKeys = true })
    }
    install(CallLogging)
    install(StatusPages) {
        exception<IllegalArgumentException> { call, cause ->
            call.respond(HttpStatusCode.BadRequest, ErrorResponse(cause.message ?: "invalid request"))
        }
        exception<Throwable> { call, cause ->
            call.respond(HttpStatusCode.InternalServerError, ErrorResponse(cause.message ?: cause.toString()))
        }
    }

    routing {
        staticResources("/", "static")

        get("/api/course") {
            call.respond(course)
        }

        post("/api/predict") {
            val req = call.receive<PredictRequest>()
            require(req.weightKg > 0) { "weightKgは正の値である必要があります" }

            val ftpWatts = req.ftpWatts ?: withContext(Dispatchers.IO) {
                val athleteId = req.athleteId
                    ?: throw IllegalArgumentException("ftpWatts、またはathleteId/apiKeyのいずれかが必要です")
                val apiKey = req.apiKey
                    ?: throw IllegalArgumentException("apiKeyが必要です")
                IntervalsIcuClient().fetchCurrentFtp(athleteId, apiKey)
            }

            val rider = RiderProfile(
                weightKg = req.weightKg,
                bikeWeightKg = req.bikeWeightKg ?: 8.0,
                ftpWatts = ftpWatts,
            )
            val prediction = predictionService.predict(course, rider)
            call.respond(prediction.toDto())
        }
    }
}
