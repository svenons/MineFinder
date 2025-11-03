/**
 * Coordinate Conversion Service
 * 
 * Handles bidirectional conversion between grid coordinates (centimeters)
 * and GPS coordinates (WGS84 latitude/longitude). Essential for translating
 * hardware GPS positions to grid cells and vice versa.
 * 
 * Coordinate Systems:
 * - Grid: High-precision centimeter coordinates (0,0) at mission origin
 * - GPS: WGS84 latitude/longitude in decimal degrees
 * - Metric: Real-world meter offsets from origin
 * 
 * Conversion Math:
 * At equator, 1 degree latitude = ~111,320 meters
 * 1 degree longitude = ~111,320 * cos(latitude) meters
 * 
 * This approximation works well for small areas (< 10km).
 * For larger areas, consider using UTM coordinate system.
 */

/**
 * Mission origin point defining the (0,0) grid position in GPS coordinates
 */
export interface OriginPoint {
  latitude: number;   // WGS84 latitude in decimal degrees
  longitude: number;  // WGS84 longitude in decimal degrees
  altitude_m?: number; // Optional: altitude above mean sea level
}

/**
 * GPS position in WGS84 coordinate system
 */
export interface GPSCoordinate {
  latitude: number;
  longitude: number;
  altitude_m?: number;
}

/**
 * Grid position with all coordinate representations
 */
export interface FullPosition {
  x_cm: number;      // Grid x in centimeters from origin
  y_cm: number;      // Grid y in centimeters from origin
  x_m: number;       // Metric x in meters from origin
  y_m: number;       // Metric y in meters from origin
  gps: GPSCoordinate; // Absolute GPS coordinates
}

/**
 * Coordinate conversion service class
 * Maintains mission origin point and provides conversion methods
 */
export class CoordinateService {
  private origin: OriginPoint;
  private metresPerCm: number;

  // Earth radius approximation for coordinate conversion
  private static readonly EARTH_RADIUS_M = 6371000;
  
  // Meters per degree latitude (constant at all latitudes)
  private static readonly METERS_PER_DEGREE_LAT = 111320;

  /**
   * Initialize coordinate service with mission origin point
   * 
   * @param origin - GPS coordinates of grid origin (0,0)
   * @param metresPerCm - Conversion factor from centimeters to meters
   */
  constructor(origin: OriginPoint, metresPerCm: number = 0.01) {
    this.origin = origin;
    this.metresPerCm = metresPerCm;
  }

  /**
   * Update mission origin point
   * Call this when reconfiguring mission area or calibrating position
   */
  setOrigin(origin: OriginPoint): void {
    this.origin = origin;
  }

  /**
   * Get current mission origin
   */
  getOrigin(): OriginPoint {
    return { ...this.origin };
  }

  /**
   * Convert grid cell coordinates to GPS coordinates
   * 
   * Algorithm:
   * 1. Convert centimeters to meters using metresPerCm
   * 2. Calculate latitude offset (y_m / meters_per_degree_lat)
   * 3. Calculate longitude offset with latitude correction
   * 4. Add offsets to origin coordinates
   * 
   * @param x_cm - Grid x coordinate in centimeters
   * @param y_cm - Grid y coordinate in centimeters
   * @returns GPS coordinates in WGS84
   */
  gridToGPS(x_cm: number, y_cm: number): GPSCoordinate {
    // Convert grid coordinates to metric offsets
    const x_m = x_cm * this.metresPerCm;
    const y_m = y_cm * this.metresPerCm;

    // Calculate latitude offset (positive y moves north)
    const latDelta = y_m / CoordinateService.METERS_PER_DEGREE_LAT;

    // Calculate longitude offset with latitude correction
    // Longitude degrees shrink towards poles: 1 deg lon = cos(lat) * base_distance
    const latRad = (this.origin.latitude * Math.PI) / 180;
    const metersPerDegreeLon = CoordinateService.METERS_PER_DEGREE_LAT * Math.cos(latRad);
    const lonDelta = x_m / metersPerDegreeLon;

    return {
      latitude: this.origin.latitude + latDelta,
      longitude: this.origin.longitude + lonDelta,
      altitude_m: this.origin.altitude_m,
    };
  }

  /**
   * Convert GPS coordinates to grid cell coordinates
   * 
   * Inverse of gridToGPS - converts absolute GPS position from hardware
   * into grid coordinates for detection placement.
   * 
   * @param gps - GPS coordinates from hardware sensor
   * @returns Grid position with all coordinate representations
   */
  gpsToGrid(gps: GPSCoordinate): FullPosition {
    // Calculate latitude difference in degrees
    const latDelta = gps.latitude - this.origin.latitude;
    
    // Convert latitude delta to meters
    const y_m = latDelta * CoordinateService.METERS_PER_DEGREE_LAT;

    // Calculate longitude difference with latitude correction
    const lonDelta = gps.longitude - this.origin.longitude;
    const latRad = (this.origin.latitude * Math.PI) / 180;
    const metersPerDegreeLon = CoordinateService.METERS_PER_DEGREE_LAT * Math.cos(latRad);
    const x_m = lonDelta * metersPerDegreeLon;

    // Convert meters to centimeters
    const x_cm = x_m / this.metresPerCm;
    const y_cm = y_m / this.metresPerCm;

    return {
      x_cm: Math.round(x_cm), // Round to nearest cm for grid alignment
      y_cm: Math.round(y_cm),
      x_m,
      y_m,
      gps,
    };
  }

  /**
   * Calculate distance between two GPS coordinates using Haversine formula
   * Useful for validating conversion accuracy or measuring detection spacing
   * 
   * @param point1 - First GPS coordinate
   * @param point2 - Second GPS coordinate
   * @returns Distance in meters
   */
  static calculateDistance(point1: GPSCoordinate, point2: GPSCoordinate): number {
    const lat1Rad = (point1.latitude * Math.PI) / 180;
    const lat2Rad = (point2.latitude * Math.PI) / 180;
    const deltaLatRad = ((point2.latitude - point1.latitude) * Math.PI) / 180;
    const deltaLonRad = ((point2.longitude - point1.longitude) * Math.PI) / 180;

    // Haversine formula
    const a =
      Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
      Math.cos(lat1Rad) * Math.cos(lat2Rad) *
      Math.sin(deltaLonRad / 2) * Math.sin(deltaLonRad / 2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return CoordinateService.EARTH_RADIUS_M * c;
  }

  /**
   * Validate that GPS coordinates are within reasonable bounds
   * Prevents processing of invalid hardware GPS data
   * 
   * @param gps - GPS coordinate to validate
   * @returns True if coordinates are valid
   */
  static isValidGPS(gps: GPSCoordinate): boolean {
    return (
      gps.latitude >= -90 &&
      gps.latitude <= 90 &&
      gps.longitude >= -180 &&
      gps.longitude <= 180 &&
      (gps.altitude_m === undefined || gps.altitude_m >= -500) // Below Dead Sea level
    );
  }

  /**
   * Calculate bearing (compass direction) from one GPS point to another
   * Returns angle in degrees (0 = North, 90 = East, 180 = South, 270 = West)
   * 
   * @param from - Starting GPS coordinate
   * @param to - Destination GPS coordinate
   * @returns Bearing in degrees (0-360)
   */
  static calculateBearing(from: GPSCoordinate, to: GPSCoordinate): number {
    const lat1Rad = (from.latitude * Math.PI) / 180;
    const lat2Rad = (to.latitude * Math.PI) / 180;
    const deltaLonRad = ((to.longitude - from.longitude) * Math.PI) / 180;

    const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
    const x =
      Math.cos(lat1Rad) * Math.sin(lat2Rad) -
      Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);

    const bearingRad = Math.atan2(y, x);
    const bearingDeg = (bearingRad * 180) / Math.PI;

    // Normalize to 0-360
    return (bearingDeg + 360) % 360;
  }

  /**
   * Check if a GPS coordinate is within the mission grid bounds
   * Useful for filtering out-of-area detections from hardware
   * 
   * @param gps - GPS coordinate to check
   * @param gridWidth_cm - Grid width in centimeters
   * @param gridHeight_cm - Grid height in centimeters
   * @returns True if coordinate is within grid bounds
   */
  isWithinGrid(gps: GPSCoordinate, gridWidth_cm: number, gridHeight_cm: number): boolean {
    const position = this.gpsToGrid(gps);
    return (
      position.x_cm >= 0 &&
      position.x_cm < gridWidth_cm &&
      position.y_cm >= 0 &&
      position.y_cm < gridHeight_cm
    );
  }

  /**
   * Convert array of grid positions to GPS waypoints
   * Used for exporting mission path to hardware navigation systems
   * 
   * @param gridPath - Array of grid coordinates
   * @returns Array of GPS waypoints
   */
  gridPathToGPSWaypoints(gridPath: Array<{ x_cm: number; y_cm: number }>): GPSCoordinate[] {
    return gridPath.map(point => this.gridToGPS(point.x_cm, point.y_cm));
  }

  /**
   * Calculate grid bounds in GPS coordinates
   * Returns the GPS rectangle containing the entire mission grid
   * 
   * @param gridWidth_cm - Grid width in centimeters
   * @param gridHeight_cm - Grid height in centimeters
   * @returns GPS bounds {north, south, east, west}
   */
  getGridBoundsGPS(gridWidth_cm: number, gridHeight_cm: number): {
    north: number;
    south: number;
    east: number;
    west: number;
  } {
    const topLeft = this.gridToGPS(0, gridHeight_cm);
    const bottomRight = this.gridToGPS(gridWidth_cm, 0);

    return {
      north: topLeft.latitude,
      south: bottomRight.latitude,
      west: this.origin.longitude,
      east: bottomRight.longitude,
    };
  }
}

/**
 * Factory function to create CoordinateService from mission configuration
 * 
 * @param originGPS - Origin GPS coordinates
 * @param metresPerCm - Grid resolution
 * @returns Configured CoordinateService instance
 */
export function createCoordinateService(
  originGPS: OriginPoint,
  metresPerCm: number = 0.01
): CoordinateService {
  return new CoordinateService(originGPS, metresPerCm);
}

/**
 * Example usage for hardware integration:
 * 
 * // Setup coordinate service with mission origin
 * const coordService = new CoordinateService({
 *   latitude: 51.505,
 *   longitude: -0.09,
 *   altitude_m: 10
 * }, 0.1); // 0.1 meters per cm
 * 
 * // Convert detection GPS from hardware to grid position
 * const detectionGPS = { latitude: 51.506, longitude: -0.089 };
 * const gridPos = coordService.gpsToGrid(detectionGPS);
 * console.log(`Detection at cell (${gridPos.x_cm}, ${gridPos.y_cm})`);
 * 
 * // Convert mission start position to GPS for hardware navigation
 * const startGPS = coordService.gridToGPS(0, 0);
 * const goalGPS = coordService.gridToGPS(50, 30);
 * console.log(`Navigate from ${startGPS.latitude},${startGPS.longitude}`);
 */
