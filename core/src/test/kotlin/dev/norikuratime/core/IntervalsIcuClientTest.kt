package dev.norikuratime.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer

class IntervalsIcuClientTest {

    @Test
    fun `fetchCurrentFtp parses icu_ftp from response`() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"id":"i1","icu_ftp":250}"""))
        server.start()
        try {
            val client = IntervalsIcuClient(baseUrl = server.url("/api/v1").toString().trimEnd('/'))
            val ftp = client.fetchCurrentFtp(athleteId = "i1", apiKey = "dummy-key")

            assertEquals(250, ftp)

            val recorded = server.takeRequest()
            assertEquals("/api/v1/athlete/i1", recorded.path)
            assertEquals(
                "Basic " + java.util.Base64.getEncoder().encodeToString("API_KEY:dummy-key".toByteArray()),
                recorded.getHeader("Authorization"),
            )
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetchCurrentFtp throws when icu_ftp is missing`() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setBody("""{"id":"i1"}"""))
        server.start()
        try {
            val client = IntervalsIcuClient(baseUrl = server.url("/api/v1").toString().trimEnd('/'))
            assertFailsWith<IntervalsIcuException> {
                client.fetchCurrentFtp(athleteId = "i1", apiKey = "dummy-key")
            }
        } finally {
            server.shutdown()
        }
    }

    @Test
    fun `fetchCurrentFtp throws on non-2xx response`() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("unauthorized"))
        server.start()
        try {
            val client = IntervalsIcuClient(baseUrl = server.url("/api/v1").toString().trimEnd('/'))
            assertFailsWith<IntervalsIcuException> {
                client.fetchCurrentFtp(athleteId = "i1", apiKey = "dummy-key")
            }
        } finally {
            server.shutdown()
        }
    }
}
