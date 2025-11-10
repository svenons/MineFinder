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

import { useState, useRef, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
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
function MapUpdater({ center, zoom, onReady }: { center: [number, number]; zoom: number; onReady?: (map: L.Map) => void; }) {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);
  return null;
}

function MapEventsBridge({ onClick, onMoveZoom, onMouseMove }: { onClick?: (latlng: L.LatLng) => void; onMoveZoom?: () => void; onMouseMove?: (latlng: L.LatLng) => void; }) {
  useMapEvents({
    click(e) {
      onClick?.(e.latlng);
    },
    move() {
      onMoveZoom?.();
    },
    zoom() {
      onMoveZoom?.();
    },
    mousemove(e) {
      onMouseMove?.(e.latlng);
    }
  });
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
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Base location in GPS coordinates (lat, lon)
  const [location, setLocation] = useState<[number, number]>([51.505, -0.09]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([51.505, -0.09]);
  // Set maximum zoom for satellite imagery detail
  const [zoom, setZoom] = useState(19);
  const [containerSize, setContainerSize] = useState({ width: 1000, height: 600 });
  
  // Coordinate conversion service for GPS/grid translation
  const [coordService, setCoordService] = useState<CoordinateService | null>(null);
  // Leaflet map instance and scaling
  const [leafletMap, setLeafletMap] = useState<L.Map | null>(null as any);
  const [metersPerPixel, setMetersPerPixel] = useState<number>(0);
  const [originPixel, setOriginPixel] = useState<{x:number;y:number}>({x:0,y:0});

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

  // Calculate pixels-per-meter using Leaflet map at current zoom
  const pixelsPerMeter = metersPerPixel > 0 ? (1 / metersPerPixel) : 0;

  // Canvas size ties to container
  const canvasWidth = containerSize.width - 0; // fill available width
  const canvasHeight = containerSize.height - 0; // fill available height

  const recalcScale = useCallback(() => {
    if (!leafletMap) return;
    const container = leafletMap.getContainer();
    const bounds = container.getBoundingClientRect();
    const center = leafletMap.getCenter();
    // Use center point to compute meters per pixel
    const p1 = leafletMap.latLngToContainerPoint(center);
    const p2 = L.point(p1.x + 1, p1.y);
    const ll1 = leafletMap.containerPointToLatLng(p1);
    const ll2 = leafletMap.containerPointToLatLng(p2);
    const mPerPixel = leafletMap.distance(ll1, ll2);
    setMetersPerPixel(mPerPixel);
    // Origin pixel for alignment (wrap to nearest world copy)
    const wrappedOrigin = L.latLng(location[0], location[1]).wrap();
    setOriginPixel(leafletMap.latLngToContainerPoint(wrappedOrigin));
    // Update container size from actual map container
    setContainerSize({ width: bounds.width, height: bounds.height });
  }, [leafletMap, location]);

  useEffect(() => {
    recalcScale();
  }, [recalcScale, zoom, mapCenter]);

  // Keep React zoom/center states in sync with Leaflet when user interacts
  useEffect(() => {
    if (!leafletMap) return;
    const handler = () => {
      const c = leafletMap.getCenter();
      setMapCenter([c.lat, c.lng]);
      setZoom(leafletMap.getZoom());
      recalcScale();
    };
    leafletMap.on('move zoom', handler);
    return () => {
      leafletMap.off('move zoom', handler);
    };
  }, [leafletMap, recalcScale]);

  // Convert map click (latlng) to grid coordinates via CoordinateService
  const handleMapClickLatLng = useCallback((latlng: L.LatLng) => {
    if (disabled || !coordService) return;
    const pos = coordService.gpsToGrid({ latitude: latlng.lat, longitude: latlng.lng });
    // Emit click position regardless of current grid size so start/goal can be set anywhere.
    if (onCellClick) {
      onCellClick({ x_cm: pos.x_cm, y_cm: pos.y_cm, x_m: pos.x_m, y_m: pos.y_m });
    }
  }, [coordService, disabled, onCellClick]);

  // Helpers to convert grid centimeters to container pixels
  const gridCmToPixel = useCallback((x_cm: number, y_cm: number): { x: number; y: number } | null => {
    if (!leafletMap || !coordService) return null;
    const gps = coordService.gridToGPS(x_cm, y_cm);
    const wrapped = L.latLng(gps.latitude, gps.longitude).wrap();
    const pt = leafletMap.latLngToContainerPoint(wrapped);
    return { x: pt.x, y: pt.y };
  }, [leafletMap, coordService]);

  const metersToCm = useCallback((meters: number) => meters / metres_per_cm, [metres_per_cm]);

  // Track mouse position over grid using GPS conversion
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!leafletMap || !coordService) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const containerPoint = L.point(e.clientX - rect.left, e.clientY - rect.top);
    const latlng = leafletMap.containerPointToLatLng(containerPoint);
    const pos = coordService.gpsToGrid({ latitude: latlng.lat, longitude: latlng.lng });
    // Bound check
    if (pos.x_cm >= 0 && pos.y_cm >= 0 && pos.x_cm <= width_cm && pos.y_cm <= height_cm) {
      setHoveredCell({ x: pos.x_cm, y: pos.y_cm });
      setHoverPixel({ x: containerPoint.x, y: containerPoint.y });
    } else {
      setHoveredCell(null);
      setHoverPixel(null);
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
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredCell(null)}
      >
        {/* Leaflet satellite imagery base layer */}
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          <MapContainer center={mapCenter} zoom={zoom} style={{ width: '100%', height: '100%' }} zoomControl={true} scrollWheelZoom={true} doubleClickZoom={true} touchZoom={true} attributionControl={false} worldCopyJump={true}>
            <MapUpdater center={mapCenter} zoom={zoom} onReady={(m) => setLeafletMap(m)} />
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='ESRI' maxZoom={19} />
            {/* Bridge map events to recalc scale and handle clicks */}
            {/* eslint-disable-next-line @typescript-eslint/no-unused-vars */}
            <MapEventsBridge onClick={handleMapClickLatLng} onMoveZoom={recalcScale} onMouseMove={(latlng) => {
              if (!coordService) return;
              const pos = coordService.gpsToGrid({ latitude: latlng.lat, longitude: latlng.lng });
              if (pos.x_cm >= 0 && pos.x_cm < width_cm && pos.y_cm >= 0 && pos.y_cm < height_cm) {
                setHoveredCell({ x: pos.x_cm, y: pos.y_cm });
              } else {
                setHoveredCell(null);
              }
            }} />
          </MapContainer>
        </div>

        {showGrid && pixelsPerMeter > 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none',
              backgroundImage:
                `linear-gradient(rgba(50, 50, 50, 0.35) 1px, transparent 1px),` +
                `linear-gradient(90deg, rgba(50, 50, 50, 0.35) 1px, transparent 1px),` +
                `linear-gradient(rgba(40, 60, 40, 0.6) 2px, transparent 2px),` +
                `linear-gradient(90deg, rgba(40, 60, 40, 0.6) 2px, transparent 2px)`,
              backgroundSize:
                `${pixelsPerMeter}px ${pixelsPerMeter}px, ` +
                `${pixelsPerMeter}px ${pixelsPerMeter}px, ` +
                `${pixelsPerMeter * 10}px ${pixelsPerMeter * 10}px, ` +
                `${pixelsPerMeter * 10}px ${pixelsPerMeter * 10}px`,
              backgroundPosition:
                `${originPixel.x % pixelsPerMeter}px ${originPixel.y % pixelsPerMeter}px, ` +
                `${originPixel.x % pixelsPerMeter}px ${originPixel.y % pixelsPerMeter}px, ` +
                `${originPixel.x % (pixelsPerMeter * 10)}px ${originPixel.y % (pixelsPerMeter * 10)}px, ` +
                `${originPixel.x % (pixelsPerMeter * 10)}px ${originPixel.y % (pixelsPerMeter * 10)}px`,
            }}
          />
        )}

        {detections.map((detection) => {
          const x_m = detection.position.x_m;
          const y_m = detection.position.y_m;
          const snapped_cm = { x_cm: metersToCm(Math.floor(x_m)), y_cm: metersToCm(Math.floor(y_m)) };
          const pt = gridCmToPixel(snapped_cm.x_cm, snapped_cm.y_cm);
          if (!pt || pixelsPerMeter <= 0) return null;
          return (
            <div
              key={detection.position_key}
              className="detection-marker"
              style={{ position: 'absolute', left: pt.x, top: pt.y, width: pixelsPerMeter, height: pixelsPerMeter, backgroundColor: `rgba(255, 0, 0, ${detection.confidence})`, border: '1px solid rgba(255, 0, 0, 0.8)', pointerEvents: 'none' }}
              title={`Mine: ${detection.confidence.toFixed(2)} confidence`}
            />
          );
        })}

        {startPosition && (() => {
          const x_m = startPosition.x_m; const y_m = startPosition.y_m;
          const exact_cm = { x_cm: metersToCm(x_m), y_cm: metersToCm(y_m) };
          const pt = gridCmToPixel(exact_cm.x_cm, exact_cm.y_cm);
          if (!pt) return null;
          const size = 20;
          return (
            <div className="start-marker" style={{ position: 'absolute', left: pt.x, top: pt.y, width: size, height: size, transform: 'translate(-50%, -50%)', borderRadius: '50%', backgroundColor: '#00ff00', border: '2px solid #0f0', color: '#000', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', zIndex: 2000, boxShadow: '0 0 0 2px rgba(0,0,0,0.4)' }}>A</div>
          );
        })()}

        {goalPosition && (() => {
          const x_m = goalPosition.x_m; const y_m = goalPosition.y_m;
          const exact_cm = { x_cm: metersToCm(x_m), y_cm: metersToCm(y_m) };
          const pt = gridCmToPixel(exact_cm.x_cm, exact_cm.y_cm);
          if (!pt) return null;
          const size = 20;
          return (
            <div className="goal-marker" style={{ position: 'absolute', left: pt.x, top: pt.y, width: size, height: size, transform: 'translate(-50%, -50%)', borderRadius: '50%', backgroundColor: '#0064ff', border: '2px solid #06f', color: '#fff', pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', fontWeight: 'bold', zIndex: 2000, boxShadow: '0 0 0 2px rgba(0,0,0,0.4)' }}>B</div>
          );
        })()}

        {hoveredCell && hoverPixel && pixelsPerMeter > 0 && (() => {
          const x_m = hoveredCell.x * metres_per_cm; const y_m = hoveredCell.y * metres_per_cm;
          const snapped_cm = { x_cm: metersToCm(Math.floor(x_m)), y_cm: metersToCm(Math.floor(y_m)) };
          const pt = gridCmToPixel(snapped_cm.x_cm, snapped_cm.y_cm);
          if (!pt) return null;
          return (
            <div className="hover-indicator" style={{ position: 'absolute', left: pt.x, top: pt.y, width: pixelsPerMeter, height: pixelsPerMeter, border: '2px solid #fff', pointerEvents: 'none' }} />
          );
        })()}
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
