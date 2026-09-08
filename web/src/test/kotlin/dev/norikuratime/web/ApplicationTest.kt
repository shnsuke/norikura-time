package dev.norikuratime.web

import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ApplicationTest {

    @Test
    fun `GET api course returns the course profile`() = testApplication {
        application { module() }
        val response = client.get("/api/course")
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("norikura_echo_line"))
        assertTrue(body.contains("20.5") || body.contains("\"endDistanceKm\":20.5"))
    }

    @Test
    fun `POST api predict with explicit ftpWatts returns a prediction`() = testApplication {
        application { module() }
        val response = client.post("/api/predict") {
            contentType(ContentType.Application.Json)
            setBody("""{"weightKg":65.0,"ftpWatts":195}""")
        }
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.bodyAsText()
        assertTrue(body.contains("totalTimeSeconds"))
        assertTrue(body.contains("\"ftpWatts\":195"))
    }

    @Test
    fun `POST api predict without ftpWatts or intervals icu credentials fails with 400`() = testApplication {
        application { module() }
        val response = client.post("/api/predict") {
            contentType(ContentType.Application.Json)
            setBody("""{"weightKg":65.0}""")
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET root serves the static frontend`() = testApplication {
        application { module() }
        val response = client.get("/")
        assertEquals(HttpStatusCode.OK, response.status)
        assertTrue(response.bodyAsText().contains("乗鞍ヒルクライム"))
    }
}
