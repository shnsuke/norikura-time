package dev.norikuratime.core

import kotlin.test.Test
import kotlin.test.assertTrue

class ClimbPredictionServiceTest {

    private val course = CourseProfile(
        id = "test",
        name = "テストコース",
        source = "unit test",
        segments = listOf(
            CourseSegment("区間1", 0.0, 8.7, 1460.0, 1870.0),
            CourseSegment("区間2", 8.7, 17.0, 1870.0, 2350.0),
            CourseSegment("区間3", 17.0, 20.5, 2350.0, 2720.0),
        ),
    )

    private val service = ClimbPredictionService()

    @Test
    fun `higher FTP produces shorter predicted time`() {
        val strongRider = RiderProfile(weightKg = 60.0, ftpWatts = 300)
        val weakRider = RiderProfile(weightKg = 60.0, ftpWatts = 200)

        val strong = service.predict(course, strongRider)
        val weak = service.predict(course, weakRider)

        assertTrue(strong.totalTime < weak.totalTime)
    }

    @Test
    fun `heavier rider with same FTP takes longer`() {
        val lightRider = RiderProfile(weightKg = 55.0, ftpWatts = 250)
        val heavyRider = RiderProfile(weightKg = 75.0, ftpWatts = 250)

        val light = service.predict(course, lightRider)
        val heavy = service.predict(course, heavyRider)

        assertTrue(light.totalTime < heavy.totalTime)
    }

    @Test
    fun `predicted time is in a plausible range for a 3 wkg rider`() {
        val rider = RiderProfile(weightKg = 65.0, ftpWatts = 195) // 3.0 W/kg
        val prediction = service.predict(course, rider)
        val minutes = prediction.totalTime.inWholeMinutes

        assertTrue(minutes in 60..160)
    }

    @Test
    fun `air density decreases with elevation`() {
        val seaLevel = service.airDensityAt(0.0)
        val summit = service.airDensityAt(2720.0)
        assertTrue(summit < seaLevel)
    }
}
