/**
 * Grid Component
 * 
 * Visual representation of the mission scan area overlaid on satellite imagery.
 * Displays mine detections, start/goal markers, and handles cell selection for
 * mission planning. Uses Leaflet with ESRI World Imagery tiles for real-world
 * satellite context.
 * 
 * The grid operates in centimeter coordinates for precision mine detection,
 * while the satellite layer uses GPS (WGS84) coordinates. This dual system
 * allows accurate positioning of detection events from hardware while providing
 * geographical context.
 */

import { useState, useRef, useEffect } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Position, AggregatedDetection } from '../types/mission.types';
import { CoordinateService } from '../services/CoordinateService';

/**
 * Grid component properties
 * Defines the mission area dimensions and interaction callbacks
 */
interface GridProps {
  width_cm: number;                         // Grid width in centimeters
  height_cm: number;                        // Grid height in centimeters
  metres_per_cm: number;                    // Conversion factor for display
  detections?: AggregatedDetection[];       // Mine detection markers to display
  startPosition?: Position | null;          // Mission start point (A)
  goalPosition?: Position | null;           // Mission goal point (B)
  onCellClick?: (position: Position) => void; // Callback when user clicks a cell
  showGrid?: boolean;                       // Toggle grid line visibility
  disabled?: boolean;                       // Disable interaction during active missions
}

/**
 * Internal component to update Leaflet map view without recreating the map
 * Leaflet requires this pattern to update center/zoom after initial render
 */
function MapUpdater({ center, zoom }: { center: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
}

export function Grid({
  width_cm,
  height_cm,
  metres_per_cm,
  detections = [],
  startPosition = null,
  goalPosition = null,
  onCellClick,
  showGrid = true,
  disabled = false,
}: GridProps) {
  const [hoveredCell, setHoveredCell] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Base location in GPS coordinates (lat, lon)
  const [location, setLocation] = useState<[number, number]>([51.505, -0.09]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([51.505, -0.09]);
  // Set maximum zoom for satellite imagery detail
  const [zoom, setZoom] = useState(19);
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 600 });
  
  // Coordinate conversion service for GPS/grid translation
  const [coordService, setCoordService] = useState<CoordinateService | null>(null);

  // Obtain device GPS location on mount
  useEffect(() => {
    let cancelled = false;

    const setFromCoords = (lat: number, lon: number) => {
      if (cancelled) return;
      setLocation([lat, lon]);
      setMapCenter([lat, lon]);
      
      // Initialize coordinate service with obtained GPS origin
      const service = new CoordinateService(
        { latitude: lat, longitude: lon },
        metres_per_cm
      );
      setCoordService(service);
    };

    // Fallback to IP-based geolocation if hardware GPS unavailable
    const fetchIpLocation = async () => {
      const providers = [
        async () => {
          const res = await fetch('https://ipapi.co/json/');
          if (!res.ok) throw new Error(`ipapi status ${res.status}`);
          return res.json();
        },
        async () => {
          const res = await fetch('https://ipwho.is/?fields=latitude,longitude');
          if (!res.ok) throw new Error(`ipwho.is status ${res.status}`);
          return res.json();
        },
      ];

      for (const provider of providers) {
        try {
          const data = await provider();
          const lat = Number(data.latitude ?? data.lat);
          const lon = Number(data.longitude ?? data.lon ?? data.lng);
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            setFromCoords(lat, lon);
            return;
          }
        } catch (err) {
          console.error('IP location lookup failed:', err);
        }
      }
    };

    // Try browser geolocation API first (most accurate)
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setFromCoords(position.coords.latitude, position.coords.longitude);
        },
        (error) => {
          console.error('Geolocation error:', error.message);
          fetchIpLocation();
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000,
        }
      );
    } else {
      fetchIpLocation();
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Update canvas dimensions on window resize
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const parent = containerRef.current.parentElement;
        if (parent) {
          setContainerSize({
            width: parent.clientWidth - 48,
            height: parent.clientHeight - 48,
          });
        }
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Calculate cell pixel size to fit grid within container
  const cellSize = Math.min(
    Math.floor(containerSize.width / width_cm),
    Math.floor(containerSize.height / height_cm),
    40
  );
  
  const canvasWidth = width_cm * cellSize;
  const canvasHeight = height_cm * cellSize;

  // Convert pixel click to grid cell coordinates
  const handleCellClick = (x_cm: number, y_cm: number) => {
    if (onCellClick) {
      onCellClick({
        x_cm,
        y_cm,
        x_m: x_cm * metres_per_cm,
        y_m: y_cm * metres_per_cm,
      });
    }
  };

  // Track mouse position over grid for hover effect
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / cellSize);
    const y = Math.floor((e.clientY - rect.top) / cellSize);
    
    if (x >= 0 && x < width_cm && y >= 0 && y < height_cm) {
      setHoveredCell({ x, y });
    } else {
      setHoveredCell(null);
    }
  };

  return (
    <div className="grid-container" ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
      {/* Satellite map controls */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: '8px', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.7)', padding: '8px', borderRadius: '4px' }}>
        <button onClick={() => setZoom(prev => Math.min(19, prev + 1))} style={{ fontSize: '18px', padding: '4px 8px' }} title="Zoom in satellite">+</button>
        <button onClick={() => setZoom(prev => Math.max(10, prev - 1))} style={{ fontSize: '18px', padding: '4px 8px' }} title="Zoom out satellite">-</button>
        <button onClick={() => { setMapCenter(location); setZoom(19); }} style={{ fontSize: '14px', padding: '4px 8px' }} title="Reset to origin">Reset</button>
        <div style={{ fontSize: '10px', color: '#ccc', textAlign: 'center' }}>Z: {zoom}</div>
      </div>

      {/* Grid canvas with satellite underlay */}
      <div className="grid-canvas" style={{ width: canvasWidth, height: canvasHeight, position: 'relative', border: '2px solid #333', cursor: disabled ? 'not-allowed' : 'crosshair', overflow: 'hidden' }}
        onClick={(e) => {
          if (disabled) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x_cm = Math.floor((e.clientX - rect.left) / cellSize);
          const y_cm = Math.floor((e.clientY - rect.top) / cellSize);
          handleCellClick(x_cm, y_cm);
        }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredCell(null)}
      >
        {/* Leaflet satellite imagery base layer */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', opacity: 0.6, pointerEvents: 'none' }}>
          <MapContainer center={mapCenter} zoom={zoom} style={{ width: '100%', height: '100%' }} zoomControl={false} dragging={false} scrollWheelZoom={false} doubleClickZoom={false} touchZoom={false} attributionControl={false}>
            <MapUpdater center={mapCenter} zoom={zoom} />
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='ESRI' maxZoom={19} />
          </MapContainer>
        </div>

        {showGrid && (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundImage: `linear-gradient(rgba(50, 50, 50, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(50, 50, 50, 0.3) 1px, transparent 1px), linear-gradient(rgba(40, 60, 40, 0.5) 2px, transparent 2px), linear-gradient(90deg, rgba(40, 60, 40, 0.5) 2px, transparent 2px)`, backgroundSize: `${cellSize}px ${cellSize}px, ${cellSize}px ${cellSize}px, ${cellSize * 10}px ${cellSize * 10}px, ${cellSize * 10}px ${cellSize * 10}px`, pointerEvents: 'none' }} />
            <svg width={canvasWidth} height={canvasHeight} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
              {Array.from({ length: width_cm + 1 }).map((_, i) => (
                <line key={`v-${i}`} x1={i * cellSize} y1={0} x2={i * cellSize} y2={canvasHeight} stroke="#333" strokeWidth={1} />
              ))}
              {Array.from({ length: height_cm + 1 }).map((_, i) => (
                <line key={`h-${i}`} x1={0} y1={i * cellSize} x2={canvasWidth} y2={i * cellSize} stroke="#333" strokeWidth={1} />
              ))}
            </svg>
          </>
        )}

        {detections.map((detection) => (
          <div key={detection.position_key} className="detection-marker" style={{ position: 'absolute', left: detection.position.x_cm * cellSize, top: detection.position.y_cm * cellSize, width: cellSize, height: cellSize, backgroundColor: `rgba(255, 0, 0, ${detection.confidence})`, border: '1px solid rgba(255, 0, 0, 0.8)', pointerEvents: 'none' }} title={`Mine: ${detection.confidence.toFixed(2)} confidence`} />
        ))}

        {startPosition && !disabled && (
          <div className="start-marker" style={{ position: 'absolute', left: startPosition.x_cm * cellSize, top: startPosition.y_cm * cellSize, width: cellSize, height: cellSize, backgroundColor: 'rgba(0, 255, 0, 0.6)', border: '2px solid #0f0', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>A</div>
        )}

        {goalPosition && !disabled && (
          <div className="goal-marker" style={{ position: 'absolute', left: goalPosition.x_cm * cellSize, top: goalPosition.y_cm * cellSize, width: cellSize, height: cellSize, backgroundColor: 'rgba(0, 100, 255, 0.6)', border: '2px solid #06f', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold' }}>B</div>
        )}

        {hoveredCell && (
          <div className="hover-indicator" style={{ position: 'absolute', left: hoveredCell.x * cellSize, top: hoveredCell.y * cellSize, width: cellSize, height: cellSize, border: '2px solid #fff', pointerEvents: 'none' }} />
        )}
      </div>

      {/* Coordinate display with GPS conversion */}
      <div style={{ height: '24px', marginTop: '8px', width: canvasWidth, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ color: '#666', fontSize: '10px' }}>Center: {mapCenter[0].toFixed(4)}, {mapCenter[1].toFixed(4)}</div>
        {hoveredCell && coordService && (
          <div style={{ color: '#ccc', fontSize: '12px', textAlign: 'center' }}>
            Position: ({hoveredCell.x}cm, {hoveredCell.y}cm) = ({(hoveredCell.x * metres_per_cm).toFixed(2)}m, {(hoveredCell.y * metres_per_cm).toFixed(2)}m)
            {(() => {
              const gps = coordService.gridToGPS(hoveredCell.x, hoveredCell.y);
              return ` | GPS: ${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}`;
            })()}
          </div>
        )}
        <div style={{ color: '#666', fontSize: '10px' }}>Origin: {location[0].toFixed(4)}, {location[1].toFixed(4)}</div>
      </div>
    </div>
  );
}
