package dev.norikuratime.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CourseProfileTest {

    private val sampleJson = """
        {
          "id": "norikura_echo_line",
          "name": "乗鞍ヒルクライム(乗鞍エコーライン)",
          "source": "test",
          "segments": [
            {"name": "区間1", "startDistanceKm": 0.0, "endDistanceKm": 8.7, "startElevationM": 1460, "endElevationM": 1870},
            {"name": "区間2", "startDistanceKm": 8.7, "endDistanceKm": 17.0, "startElevationM": 1870, "endElevationM": 2350},
            {"name": "区間3", "startDistanceKm": 17.0, "endDistanceKm": 20.5, "startElevationM": 2350, "endElevationM": 2720}
          ]
        }
    """.trimIndent()

    @Test
    fun `parses JSON into CourseProfile`() {
        val course = CourseProfile.parse(sampleJson)
        assertEquals("norikura_echo_line", course.id)
        assertEquals(3, course.segments.size)
    }

    @Test
    fun `total distance and elevation gain match official course figures`() {
        val course = CourseProfile.parse(sampleJson)
        assertEquals(20.5, course.totalDistanceKm, 0.01)
        assertEquals(1260.0, course.totalElevationGainM, 0.01)
        assertTrue(course.averageGradient in 0.05..0.07)
    }

    @Test
    fun `segment gradient is computed from distance and elevation`() {
        val segment = CourseSegment(
            name = "test",
            startDistanceKm = 0.0,
            endDistanceKm = 10.0,
            startElevationM = 1000.0,
            endElevationM = 1600.0,
        )
        // 600m / 10000m = 6%
        assertEquals(0.06, segment.averageGradient, 0.0001)
    }
}
