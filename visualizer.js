// Initialize the map
const map = L.map('map').setView([59.9139, 10.7522], 12); // Oslo coordinates

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Layer group for zones
let zonesLayer = L.layerGroup().addTo(map);
// Store all zone features for overlap detection
let allZones = [];

// Helper function to check if a point is inside a polygon
function isPointInPolygon(point, polygon) {
    const x = point.lat, y = point.lng;
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat, yi = polygon[i].lng;
        const xj = polygon[j].lat, yj = polygon[j].lng;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

// Function to determine zone color based on rules
function getZoneColor(rules) {
    if (!rules || rules.length === 0) {
        return { color: '#2196F3', fillColor: 'rgba(33, 150, 243, 0.3)' };
    }

    // Check rules for the first rule (could be enhanced to handle multiple vehicle types)
    const rule = rules[0];

    // No ride zones (can't start, end, or go through)
    if (!rule.ride_start_allowed && !rule.ride_end_allowed && !rule.ride_through_allowed) {
        return { color: '#f44336', fillColor: 'rgba(244, 67, 54, 0.3)' };
    }

    // Partial restriction zones (can ride through but can't start and/or end)
    if ((!rule.ride_start_allowed || !rule.ride_end_allowed) && rule.ride_through_allowed) {
        return { color: '#9C27B0', fillColor: 'rgba(156, 39, 176, 0.3)' };
    }

    // Station parking required
    if (rule.station_parking) {
        return { color: '#4CAF50', fillColor: 'rgba(76, 175, 80, 0.3)' };
    }

    // Speed limited zones
    if (rule.maximum_speed_kph !== undefined) {
        return { color: '#FFC107', fillColor: 'rgba(255, 193, 7, 0.3)' };
    }

    // Default zone color
    return { color: '#2196F3', fillColor: 'rgba(33, 150, 243, 0.3)' };
}

// Function to create popup content for a single zone
function createZoneInfo(feature) {
    const props = feature.properties;
    let name = 'Unnamed Zone';

    if (props.name && props.name.length > 0) {
        name = props.name[0].text;
    }

    let html = `<h4>${name}</h4>`;

    if (props.start) {
        html += `<div><strong>Start:</strong> ${new Date(props.start).toLocaleString()}</div>`;
    }
    if (props.end) {
        html += `<div><strong>End:</strong> ${new Date(props.end).toLocaleString()}</div>`;
    }

    if (props.rules && props.rules.length > 0) {
        html += `<div style="margin-top: 10px;"><strong>Rules:</strong></div>`;
        props.rules.forEach((rule, index) => {
            html += `<div class="rule">`;

            if (rule.vehicle_type_ids && rule.vehicle_type_ids.length > 0) {
                html += `<div><span class="rule-label">Vehicle Types:</span> <span class="rule-value">${rule.vehicle_type_ids.join(', ')}</span></div>`;
            }

            html += `<div><span class="rule-label">Ride Start:</span> <span class="rule-value ${rule.ride_start_allowed ? 'allowed' : 'forbidden'}">${rule.ride_start_allowed ? '✓ Allowed' : '✗ Forbidden'}</span></div>`;
            html += `<div><span class="rule-label">Ride End:</span> <span class="rule-value ${rule.ride_end_allowed ? 'allowed' : 'forbidden'}">${rule.ride_end_allowed ? '✓ Allowed' : '✗ Forbidden'}</span></div>`;
            html += `<div><span class="rule-label">Ride Through:</span> <span class="rule-value ${rule.ride_through_allowed ? 'allowed' : 'forbidden'}">${rule.ride_through_allowed ? '✓ Allowed' : '✗ Forbidden'}</span></div>`;

            if (rule.station_parking !== undefined) {
                html += `<div><span class="rule-label">Station Parking:</span> <span class="rule-value ${rule.station_parking ? 'allowed' : ''}">${rule.station_parking ? '✓ Required' : '✗ Not Required'}</span></div>`;
            }

            if (rule.maximum_speed_kph !== undefined) {
                html += `<div><span class="rule-label">Max Speed:</span> <span class="rule-value">${rule.maximum_speed_kph} km/h</span></div>`;
            }

            html += `</div>`;
        });
    }

    return html;
}

// Function to create popup content (handles multiple overlapping zones)
function createPopupContent(features) {
    let html = `<div class="popup-content">`;

    if (features.length === 1) {
        html += createZoneInfo(features[0]);
    } else {
        html += `<h4 style="color: #ff6b6b;">⚠ ${features.length} Overlapping Zones</h4>`;
        html += `<div style="max-height: 400px; overflow-y: auto;">`;
        features.forEach((feature, index) => {
            if (index > 0) {
                html += `<hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">`;
            }
            html += `<div style="padding: 5px 0;">`;
            html += createZoneInfo(feature);
            html += `</div>`;
        });
        html += `</div>`;
    }

    html += `</div>`;
    return html;
}

// Function to load and display geofencing zones
function loadGeofencingZones(data) {
    // Clear existing zones
    zonesLayer.clearLayers();
    allZones = [];

    try {
        // Parse if string
        if (typeof data === 'string') {
            data = JSON.parse(data);
        }

        // Check for valid GBFS structure
        if (!data.data || !data.data.geofencing_zones) {
            throw new Error('Invalid GBFS geofencing zones format');
        }

        const geofencingZones = data.data.geofencing_zones;
        const features = geofencingZones.features;

        // Statistics
        let zoneCount = 0;
        let stationParkingCount = 0;
        let noRideCount = 0;
        let speedLimitCount = 0;

        // Process each feature
        features.forEach(feature => {
            if (feature.geometry && feature.geometry.type === 'MultiPolygon') {
                const colors = getZoneColor(feature.properties.rules);

                // Convert MultiPolygon coordinates to Leaflet format
                const latLngs = feature.geometry.coordinates.map(polygon =>
                    polygon.map(ring =>
                        ring.map(coord => [coord[1], coord[0]]) // Swap lng/lat to lat/lng
                    )
                );

                // Store feature data for overlap detection
                allZones.push({
                    feature: feature,
                    latLngs: latLngs
                });

                // Create polygon for each part of the MultiPolygon
                latLngs.forEach(polygonCoords => {
                    const polygon = L.polygon(polygonCoords, {
                        color: colors.color,
                        fillColor: colors.fillColor,
                        fillOpacity: 0.5,
                        weight: 2
                    });

                    // Store reference to feature in polygon
                    polygon.feature = feature;

                    // Add click handler for overlap detection
                    polygon.on('click', function(e) {
                        const clickPoint = e.latlng;
                        const overlappingZones = [];

                        // Check all zones for overlap at click point
                        allZones.forEach(zone => {
                            zone.latLngs.forEach(polygonCoords => {
                                // Create temporary polygon to test point inclusion
                                const testPoly = L.polygon(polygonCoords);
                                if (testPoly.getBounds().contains(clickPoint)) {
                                    // More precise check
                                    const polyPoints = polygonCoords[0].map(coord => L.latLng(coord));
                                    if (isPointInPolygon(clickPoint, polyPoints)) {
                                        overlappingZones.push(zone.feature);
                                    }
                                }
                            });
                        });

                        // Remove duplicates
                        const uniqueZones = overlappingZones.filter((zone, index, self) =>
                            index === self.findIndex(z => z === zone)
                        );

                        // Create and open popup
                        const popup = L.popup({
                            maxWidth: 400,
                            maxHeight: 500
                        })
                            .setLatLng(clickPoint)
                            .setContent(createPopupContent(uniqueZones))
                            .openOn(map);

                        L.DomEvent.stopPropagation(e);
                    });

                    polygon.addTo(zonesLayer);
                });

                zoneCount++;

                // Update statistics
                if (feature.properties.rules && feature.properties.rules.length > 0) {
                    const rule = feature.properties.rules[0];
                    if (rule.station_parking) stationParkingCount++;
                    if (!rule.ride_start_allowed && !rule.ride_end_allowed && !rule.ride_through_allowed) noRideCount++;
                    if (rule.maximum_speed_kph !== undefined) speedLimitCount++;
                }
            }
        });

        // Update statistics display
        const statsDiv = document.getElementById('stats');
        statsDiv.innerHTML = `
            <div><strong>Total Zones:</strong> ${zoneCount}</div>
            <div><strong>Station Parking:</strong> ${stationParkingCount}</div>
            <div><strong>No Ride Zones:</strong> ${noRideCount}</div>
            <div><strong>Speed Limited:</strong> ${speedLimitCount}</div>
            <div><strong>Last Updated:</strong> ${new Date(data.last_updated).toLocaleString()}</div>
        `;

        // Fit map to zones
        if (zoneCount > 0) {
            try {
                // Create bounds manually from all layers
                let bounds = null;
                zonesLayer.eachLayer(function(layer) {
                    if (layer.getBounds) {
                        if (!bounds) {
                            bounds = layer.getBounds();
                        } else {
                            bounds.extend(layer.getBounds());
                        }
                    }
                });

                if (bounds) {
                    map.fitBounds(bounds, { padding: [50, 50] });
                }
            } catch (e) {
                console.log('Could not fit bounds:', e);
            }
        }

    } catch (error) {
        console.error('Error loading geofencing zones:', error);
        alert('Error loading geofencing zones: ' + error.message);
    }
}

// Handle file input
document.getElementById('fileInput').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = function(event) {
            loadGeofencingZones(event.target.result);
        };
        reader.readAsText(file);
    }
});
