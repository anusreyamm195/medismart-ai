import { useEffect } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";

const defaultCenter = [12.9716, 77.5946];
const markerIcon = divIcon({
  className: "store-map-marker",
  html: "<span></span>",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

function MapCenter({ position }) {
  const map = useMap();

  useEffect(() => {
    if (position) map.setView([position.latitude, position.longitude], Math.max(map.getZoom(), 15));
  }, [map, position]);

  return null;
}

function MapSelection({ position, onSelect }) {
  useMapEvents({
    click(event) {
      onSelect({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });

  if (!position) return null;
  return (
    <Marker
      position={[position.latitude, position.longitude]}
      icon={markerIcon}
      draggable
      eventHandlers={{
        dragend(event) {
          const point = event.target.getLatLng();
          onSelect({ latitude: point.lat, longitude: point.lng });
        },
      }}
    />
  );
}

export default function StoreLocationPicker({ position, onSelect, onUseCurrentLocation, locating, disabled }) {
  return (
    <div className="store-location-picker">
      <MapContainer
        center={position ? [position.latitude, position.longitude] : defaultCenter}
        zoom={position ? 15 : 11}
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapCenter position={position} />
        <MapSelection position={position} onSelect={onSelect} />
      </MapContainer>
      <div className="store-location-actions">
        <small>{position ? "Pin set. Drag it to adjust, or click the map to move it." : "Click the map to pin your store location."}</small>
        <button
          className="button button-outline button-small"
          type="button"
          onClick={onUseCurrentLocation}
          disabled={disabled || locating}
        >
          {locating ? "Locating…" : "Use my current location"}
        </button>
      </div>
    </div>
  );
}
