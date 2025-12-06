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
import { MapContainer, TileLayer, useMap, Marker, Popup, useMapEvents } from 'react-leaflet';
import { DivIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Position } from '../types/mission.types';
import { CoordinateService } from '../services/CoordinateService';
import type { GPSCoordinate } from '../services/CoordinateService';

/**
 * Grid component properties
 * Defines the mission area dimensions and interaction callbacks
 */
interface GridProps {
  startPosition?: Position | null;          // Mission start point (A) with GPS
  goalPosition?: Position | null;           // Mission goal point (B) with GPS
  onPositionClick?: (gps: GPSCoordinate) => void; // Callback when user clicks map with GPS coords
  disabled?: boolean;                       // Disable interaction during active missions
}

/**
 * Custom marker icons for A and B points
 */
const createMarkerIcon = (label: string, color: string): DivIcon => {
  return new DivIcon({
    html: `<div style="
      background-color: ${color};
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 3px solid white;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: white;
      font-size: 16px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.4);
    ">${label}</div>`,
    className: 'custom-marker',
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
};

const markerIconA = createMarkerIcon('A', '#22c55e');
const markerIconB = createMarkerIcon('B', '#3b82f6');

/**
 * Internal component to handle map click events for placing waypoints
 */
function MapClickHandler({ onMapClick, disabled }: { onMapClick: (gps: GPSCoordinate) => void; disabled: boolean }) {
  useMapEvents({
    click: (e) => {
      if (!disabled) {
        onMapClick({
          latitude: e.latlng.lat,
          longitude: e.latlng.lng,
        });
      }
    },
  });
  return null;
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
  startPosition = null,
  goalPosition = null,
  onPositionClick,
  disabled = false,
}: GridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Base location in GPS coordinates (lat, lon)
  const [location, setLocation] = useState<[number, number]>([51.505, -0.09]);
  const [mapCenter, setMapCenter] = useState<[number, number]>([51.505, -0.09]);
  // Set maximum zoom for satellite imagery detail
  const [zoom, setZoom] = useState(19);
  
  // Coordinate conversion service for GPS/grid translation (used when we add grid-based features)
  const [, setCoordService] = useState<CoordinateService | null>(null);
  
  // Handle map click - pass GPS coordinates up
  const handleMapClick = useCallback((gps: GPSCoordinate) => {
    if (onPositionClick) {
      onPositionClick(gps);
    }
  }, [onPositionClick]);

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
        0.01 // 1cm = 0.01m
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

  return (
    <div className="grid-container" ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Satellite map controls */}
      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 1000, display: 'flex', gap: '8px', flexDirection: 'column', backgroundColor: 'rgba(0,0,0,0.7)', padding: '8px', borderRadius: '4px' }}>
        <button onClick={() => setZoom(prev => Math.min(21, prev + 1))} style={{ fontSize: '18px', padding: '4px 8px' }} title="Zoom in satellite">+</button>
        <button onClick={() => setZoom(prev => Math.max(10, prev - 1))} style={{ fontSize: '18px', padding: '4px 8px' }} title="Zoom out satellite">-</button>
        <button onClick={() => { setMapCenter(location); setZoom(19); }} style={{ fontSize: '14px', padding: '4px 8px' }} title="Reset to origin">Reset</button>
        <div style={{ fontSize: '10px', color: '#ccc', textAlign: 'center' }}>Z: {zoom}</div>
      </div>

      {/* Full-size Map */}
      <div style={{ flex: 1, position: 'relative', border: '2px solid #333', overflow: 'hidden' }}>
        {/* Leaflet satellite imagery base layer - fully interactive */}
        <MapContainer center={mapCenter} zoom={zoom} style={{ width: '100%', height: '100%' }} zoomControl={false} scrollWheelZoom={true} doubleClickZoom={true} touchZoom={true} dragging={true} attributionControl={false}>
          <MapUpdater center={mapCenter} zoom={zoom} />
          <MapClickHandler onMapClick={handleMapClick} disabled={disabled} />
          <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" attribution='ESRI' maxZoom={21} />
          
          {/* Point A marker - GPS bound, stays in place when zooming/panning */}
          {startPosition?.gps && (
            <Marker position={[startPosition.gps.latitude, startPosition.gps.longitude]} icon={markerIconA}>
              <Popup>
                <strong>Point A (Start)</strong><br />
                {startPosition.gps.latitude.toFixed(6)}, {startPosition.gps.longitude.toFixed(6)}
              </Popup>
            </Marker>
          )}
          
          {/* Point B marker - GPS bound, stays in place when zooming/panning */}
          {goalPosition?.gps && (
            <Marker position={[goalPosition.gps.latitude, goalPosition.gps.longitude]} icon={markerIconB}>
              <Popup>
                <strong>Point B (Goal)</strong><br />
                {goalPosition.gps.latitude.toFixed(6)}, {goalPosition.gps.longitude.toFixed(6)}
              </Popup>
            </Marker>
          )}
        </MapContainer>
      </div>

      {/* Coordinate display with GPS info */}
      <div style={{ height: '32px', padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #333' }}>
        <div style={{ color: '#666', fontSize: '11px' }}>
          A: {startPosition?.gps ? `${startPosition.gps.latitude.toFixed(5)}, ${startPosition.gps.longitude.toFixed(5)}` : 'Click to set'}
        </div>
        <div style={{ color: '#666', fontSize: '11px' }}>
          B: {goalPosition?.gps ? `${goalPosition.gps.latitude.toFixed(5)}, ${goalPosition.gps.longitude.toFixed(5)}` : 'Click to set'}
        </div>
        <div style={{ color: '#666', fontSize: '11px' }}>Origin: {location[0].toFixed(4)}, {location[1].toFixed(4)}</div>
      </div>
    </div>
  );
}
