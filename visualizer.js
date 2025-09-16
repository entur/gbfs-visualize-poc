// Initialize the map
const map = L.map('map').setView([59.9139, 10.7522], 12); // Oslo coordinates

// Add OpenStreetMap tiles
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Layer groups for different data types
const layers = {
    zones: L.layerGroup(),
    stations: L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true
    }),
    vehicles: L.markerClusterGroup({
        maxClusterRadius: 30,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        disableClusteringAtZoom: 16
    }),
    regions: L.layerGroup()
};

// Add all layers to map (will be toggled via controls)
Object.values(layers).forEach(layer => layer.addTo(map));

// Performance settings
const performanceSettings = {
    maxVehiclesWithoutClustering: 100,
    maxStationsWithoutClustering: 50,
    minZoomForVehicles: 12,
    minZoomForAllMarkers: 10
};

// Zoom-based performance optimization
map.on('zoomend', function() {
    const currentZoom = map.getZoom();

    // Show/hide vehicles based on zoom level
    if (vehicleData.length > performanceSettings.maxVehiclesWithoutClustering) {
        if (currentZoom < performanceSettings.minZoomForVehicles) {
            if (map.hasLayer(layers.vehicles)) {
                map.removeLayer(layers.vehicles);
            }
        } else {
            if (!map.hasLayer(layers.vehicles)) {
                // Check if vehicles layer should be visible based on checkbox
                const vehiclesToggle = document.getElementById('vehiclesToggle');
                if (vehiclesToggle && vehiclesToggle.checked) {
                    map.addLayer(layers.vehicles);
                }
            }
        }
    }
});

// GBFS Loader instance
const gbfsLoader = new GBFSLoader();

// Store for all data
let allZones = [];
let stationData = [];
let vehicleData = [];

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

// Create zone info HTML
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

// Create popup content for overlapping zones
function createZonePopupContent(features) {
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

// Load and display geofencing zones
function loadGeofencingZones(data) {
    // Clear existing zones
    layers.zones.clearLayers();
    allZones = [];

    try {
        if (!data.data || !data.data.geofencing_zones) {
            console.log('No geofencing zones data found');
            return 0;
        }

        const geofencingZones = data.data.geofencing_zones;
        const features = geofencingZones.features;

        let zoneCount = 0;

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
                            .setContent(createZonePopupContent(uniqueZones))
                            .openOn(map);

                        L.DomEvent.stopPropagation(e);
                    });

                    polygon.addTo(layers.zones);
                });

                zoneCount++;
            }
        });

        // Show/hide legend based on zones
        document.getElementById('zoneLegend').style.display = zoneCount > 0 ? 'block' : 'none';

        return zoneCount;

    } catch (error) {
        console.error('Error loading geofencing zones:', error);
        throw error;
    }
}

// Create optimized station icon
function createStationIcon(status) {
    const available = status ? status.num_vehicles_available || 0 : 0;
    const color = available > 0 ? '#4CAF50' : '#FF9800';

    return L.divIcon({
        className: 'station-marker',
        html: `<div style="width: 12px; height: 12px; background: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
}

// Load and display stations
function loadStations(stationInfo, stationStatus) {
    layers.stations.clearLayers();
    stationData = [];

    try {
        if (!stationInfo || !stationInfo.data || !stationInfo.data.stations) {
            console.log('No station information found');
            return 0;
        }

        const stations = stationInfo.data.stations;
        const statusMap = {};

        // Create status map if available
        if (stationStatus && stationStatus.data && stationStatus.data.stations) {
            stationStatus.data.stations.forEach(status => {
                statusMap[status.station_id] = status;
            });
        }

        stations.forEach(station => {
            const status = statusMap[station.station_id];

            // Create optimized marker
            const marker = L.marker([station.lat, station.lon], {
                icon: createStationIcon(status)
            });

            // Create popup content
            let popupContent = `<div class="popup-content">`;
            popupContent += `<h4>${station.name[0].text}</h4>`;
            popupContent += `<div><strong>ID:</strong> ${station.station_id}</div>`;

            if (station.capacity !== undefined) {
                popupContent += `<div><strong>Capacity:</strong> ${station.capacity}</div>`;
            }

            if (status) {
                if (status.num_vehicles_available !== undefined) {
                    popupContent += `<div><strong>Vehicles Available:</strong> ${status.num_vehicles_available}</div>`;
                }
                if (status.num_docks_available !== undefined) {
                    popupContent += `<div><strong>Docks Available:</strong> ${status.num_docks_available}</div>`;
                }
                if (status.is_installed !== undefined) {
                    popupContent += `<div><strong>Status:</strong> ${status.is_installed ? 'Installed' : 'Not Installed'}</div>`;
                }
            }

            popupContent += `</div>`;

            marker.bindPopup(popupContent);
            marker.addTo(layers.stations);

            stationData.push({
                station: station,
                status: status,
                marker: marker
            });
        });

        // Show/hide legend based on stations
        document.getElementById('stationLegend').style.display = stations.length > 0 ? 'block' : 'none';

        return stations.length;

    } catch (error) {
        console.error('Error loading stations:', error);
        throw error;
    }
}

// Create optimized vehicle icon
function createVehicleIcon(vehicle) {
    const battery = vehicle.current_fuel_percent ? Math.round(vehicle.current_fuel_percent * 100) : 100;
    const isDisabled = vehicle.is_disabled;
    const isReserved = vehicle.is_reserved;

    let color = '#4CAF50'; // Available
    if (isDisabled) color = '#757575'; // Disabled
    else if (isReserved) color = '#FF9800'; // Reserved
    else if (battery < 20) color = '#F44336'; // Low battery

    return L.divIcon({
        className: 'vehicle-marker',
        html: `<div style="width: 8px; height: 8px; background: ${color}; border: 1px solid white; border-radius: 50%; box-shadow: 0 0 3px rgba(0,0,0,0.4);"></div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4]
    });
}

// Load and display vehicles with performance optimizations
function loadVehicles(data) {
    layers.vehicles.clearLayers();
    vehicleData = [];

    try {
        if (!data || !data.data || !data.data.vehicles) {
            console.log('No vehicle data found');
            return 0;
        }

        const vehicles = data.data.vehicles;

        // Performance optimization: limit vehicles shown at low zoom levels
        const currentZoom = map.getZoom();
        const shouldShowVehicles = currentZoom >= performanceSettings.minZoomForVehicles ||
                                 vehicles.length <= performanceSettings.maxVehiclesWithoutClustering;

        if (!shouldShowVehicles) {
            console.log(`Skipping ${vehicles.length} vehicles at zoom level ${currentZoom}. Zoom in to see vehicles.`);
            return vehicles.length;
        }

        vehicles.forEach(vehicle => {
            if (vehicle.lat && vehicle.lon) {
                // Create optimized marker
                const marker = L.marker([vehicle.lat, vehicle.lon], {
                    icon: createVehicleIcon(vehicle)
                });

                // Create popup content
                let popupContent = `<div class="popup-content">`;
                popupContent += `<h4>Vehicle ${vehicle.vehicle_id}</h4>`;

                if (vehicle.vehicle_type_id) {
                    popupContent += `<div><strong>Type:</strong> ${vehicle.vehicle_type_id}</div>`;
                }
                if (vehicle.is_reserved !== undefined) {
                    popupContent += `<div><strong>Reserved:</strong> ${vehicle.is_reserved ? 'Yes' : 'No'}</div>`;
                }
                if (vehicle.is_disabled !== undefined) {
                    popupContent += `<div><strong>Disabled:</strong> ${vehicle.is_disabled ? 'Yes' : 'No'}</div>`;
                }
                if (vehicle.current_fuel_percent !== undefined) {
                    popupContent += `<div><strong>Battery:</strong> ${Math.round(vehicle.current_fuel_percent * 100)}%</div>`;
                }
                if (vehicle.current_range_meters !== undefined) {
                    popupContent += `<div><strong>Range:</strong> ${(vehicle.current_range_meters / 1000).toFixed(1)} km</div>`;
                }

                popupContent += `</div>`;

                marker.bindPopup(popupContent);
                marker.addTo(layers.vehicles);

                vehicleData.push({
                    vehicle: vehicle,
                    marker: marker
                });
            }
        });

        // Show/hide legend based on vehicles
        document.getElementById('vehicleLegend').style.display = vehicles.length > 0 ? 'block' : 'none';

        return vehicles.length;

    } catch (error) {
        console.error('Error loading vehicles:', error);
        throw error;
    }
}

// Update system information display
function updateSystemInfo(systemInfo) {
    const infoDiv = document.getElementById('systemInfo');

    if (!systemInfo) {
        infoDiv.innerHTML = '<p style="color: #999; font-size: 13px;">No system information available</p>';
        return;
    }

    let html = '';

    if (systemInfo.name) {
        const name = systemInfo.name[0] ? systemInfo.name[0].text : systemInfo.name;
        html += `<div class="info-row"><span class="info-label">System:</span><span class="info-value">${name}</span></div>`;
    }

    if (systemInfo.operator) {
        const operator = systemInfo.operator[0] ? systemInfo.operator[0].text : systemInfo.operator;
        html += `<div class="info-row"><span class="info-label">Operator:</span><span class="info-value">${operator}</span></div>`;
    }

    if (systemInfo.timezone) {
        html += `<div class="info-row"><span class="info-label">Timezone:</span><span class="info-value">${systemInfo.timezone}</span></div>`;
    }

    if (systemInfo.language) {
        html += `<div class="info-row"><span class="info-label">Language:</span><span class="info-value">${systemInfo.language}</span></div>`;
    }

    if (systemInfo.email) {
        html += `<div class="info-row"><span class="info-label">Email:</span><span class="info-value">${systemInfo.email}</span></div>`;
    }

    if (systemInfo.phone_number) {
        html += `<div class="info-row"><span class="info-label">Phone:</span><span class="info-value">${systemInfo.phone_number}</span></div>`;
    }

    infoDiv.innerHTML = html || '<p style="color: #999; font-size: 13px;">Limited system information available</p>';
}

// Update statistics
function updateStats(counts) {
    const statsDiv = document.getElementById('stats');

    let html = '';

    if (counts.stations !== undefined) {
        html += `<div class="info-row"><span class="info-label">Stations:</span><span class="info-value">${counts.stations}</span></div>`;
    }

    if (counts.vehicles !== undefined) {
        html += `<div class="info-row"><span class="info-label">Vehicles:</span><span class="info-value">${counts.vehicles}</span></div>`;
    }

    if (counts.zones !== undefined) {
        html += `<div class="info-row"><span class="info-label">Geofencing Zones:</span><span class="info-value">${counts.zones}</span></div>`;
    }

    if (counts.stationParking !== undefined) {
        html += `<div class="info-row"><span class="info-label">Station Parking Zones:</span><span class="info-value">${counts.stationParking}</span></div>`;
    }

    if (counts.noRide !== undefined) {
        html += `<div class="info-row"><span class="info-label">No Ride Zones:</span><span class="info-value">${counts.noRide}</span></div>`;
    }

    if (counts.speedLimited !== undefined) {
        html += `<div class="info-row"><span class="info-label">Speed Limited Zones:</span><span class="info-value">${counts.speedLimited}</span></div>`;
    }

    statsDiv.innerHTML = html || '<p style="color: #999; font-size: 13px;">No statistics available</p>';
}

// Create layer controls
function createLayerControls(availableFeeds, loadedCounts) {
    const controlsDiv = document.getElementById('layerControls');

    let html = '';

    // Geofencing zones
    if (availableFeeds.includes('geofencing_zones')) {
        html += `<div class="layer-item">
            <label>
                <input type="checkbox" id="zonesToggle" checked>
                <span>Geofencing Zones</span>
            </label>
            <span class="layer-count">${loadedCounts.zones || 0}</span>
        </div>`;
    }

    // Stations
    if (availableFeeds.includes('station_information')) {
        html += `<div class="layer-item">
            <label>
                <input type="checkbox" id="stationsToggle" checked>
                <span>Stations</span>
            </label>
            <span class="layer-count">${loadedCounts.stations || 0}</span>
        </div>`;
    }

    // Vehicles
    if (availableFeeds.includes('vehicle_status')) {
        html += `<div class="layer-item">
            <label>
                <input type="checkbox" id="vehiclesToggle" checked>
                <span>Vehicles</span>
            </label>
            <span class="layer-count">${loadedCounts.vehicles || 0}</span>
        </div>`;
    }

    controlsDiv.innerHTML = html;

    // Add event listeners
    const zonesToggle = document.getElementById('zonesToggle');
    if (zonesToggle) {
        zonesToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                map.addLayer(layers.zones);
            } else {
                map.removeLayer(layers.zones);
            }
        });
    }

    const stationsToggle = document.getElementById('stationsToggle');
    if (stationsToggle) {
        stationsToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                map.addLayer(layers.stations);
            } else {
                map.removeLayer(layers.stations);
            }
        });
    }

    const vehiclesToggle = document.getElementById('vehiclesToggle');
    if (vehiclesToggle) {
        vehiclesToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                map.addLayer(layers.vehicles);
            } else {
                map.removeLayer(layers.vehicles);
            }
        });
    }
}

// Main function to load GBFS system
async function loadGBFSSystem(data, sourcePath = '') {
    const loadingIndicator = document.getElementById('loadingIndicator');
    const errorMessage = document.getElementById('errorMessage');

    loadingIndicator.classList.add('active');
    errorMessage.classList.remove('active');

    try {
        // Clear all layers and reset their visibility
        Object.values(layers).forEach(layer => {
            layer.clearLayers();
            if (map.hasLayer(layer)) {
                map.removeLayer(layer);
            }
            map.addLayer(layer); // Re-add all layers as visible
        });

        // Hide all legend sections
        document.getElementById('zoneLegend').style.display = 'none';
        document.getElementById('stationLegend').style.display = 'none';
        document.getElementById('vehicleLegend').style.display = 'none';

        // Load discovery file
        const discovery = await gbfsLoader.loadGBFS(data, sourcePath);
        console.log('GBFS Discovery loaded:', discovery);

        const availableFeeds = gbfsLoader.getAvailableFeeds();
        const counts = {};

        // Load essential feeds
        const feedsToLoad = [
            'system_information',
            'geofencing_zones',
            'station_information',
            'station_status',
            'vehicle_status',
            'vehicle_types'
        ].filter(feed => availableFeeds.includes(feed));

        const { results, errors } = await gbfsLoader.loadFeeds(feedsToLoad);

        // Process loaded data
        if (results.geofencing_zones) {
            counts.zones = loadGeofencingZones(results.geofencing_zones);

            // Calculate zone statistics
            if (allZones.length > 0) {
                counts.stationParking = 0;
                counts.noRide = 0;
                counts.speedLimited = 0;

                allZones.forEach(zone => {
                    if (zone.feature.properties.rules && zone.feature.properties.rules.length > 0) {
                        const rule = zone.feature.properties.rules[0];
                        if (rule.station_parking) counts.stationParking++;
                        if (!rule.ride_start_allowed && !rule.ride_end_allowed && !rule.ride_through_allowed) counts.noRide++;
                        if (rule.maximum_speed_kph !== undefined) counts.speedLimited++;
                    }
                });
            }
        }

        if (results.station_information) {
            counts.stations = loadStations(results.station_information, results.station_status);
        }

        if (results.vehicle_status) {
            counts.vehicles = loadVehicles(results.vehicle_status);
        }

        // Update UI
        updateSystemInfo(gbfsLoader.getSystemInfo());
        updateStats(counts);
        createLayerControls(availableFeeds, counts);

        // Fit map to all loaded data
        fitMapToBounds();

        // Report any errors
        if (errors.length > 0) {
            console.warn('Some feeds failed to load:', errors);

            const hasLocalFileErrors = errors.some(e =>
                e.error.includes('Cannot load local file') ||
                e.error.includes('File not found') ||
                e.error.includes('Failed to fetch')
            );
            if (hasLocalFileErrors) {
                errorMessage.innerHTML = `
                    <strong>Local File Limitation:</strong><br>
                    Some feeds couldn't be loaded because they reference local files.
                    For local GBFS data, either:
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li>Serve the files via a web server (like the current one on localhost:8000)</li>
                        <li>Load individual feed files manually</li>
                        <li>Use GBFS data from a public URL</li>
                    </ul>
                `;
                errorMessage.classList.add('active');
            }
        }

        loadingIndicator.classList.remove('active');

    } catch (error) {
        console.error('Error loading GBFS system:', error);
        errorMessage.textContent = `Error: ${error.message}`;
        errorMessage.classList.add('active');
        loadingIndicator.classList.remove('active');
    }
}

// Fit map to show all loaded data
function fitMapToBounds() {
    const allBounds = [];

    // Collect bounds from all layers
    ['zones', 'stations', 'vehicles'].forEach(layerName => {
        const layer = layers[layerName];
        if (layer && map.hasLayer(layer)) {
            layer.eachLayer(sublayer => {
                if (sublayer.getBounds) {
                    allBounds.push(sublayer.getBounds());
                } else if (sublayer.getLatLng) {
                    allBounds.push(L.latLngBounds([sublayer.getLatLng()]));
                }
            });
        }
    });

    // Fit to combined bounds
    if (allBounds.length > 0) {
        const combined = allBounds.reduce((acc, bounds) => acc.extend(bounds), allBounds[0]);
        map.fitBounds(combined, { padding: [50, 50] });
    }
}

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        // Remove active class from all tabs and contents
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        // Add active class to clicked tab and corresponding content
        tab.classList.add('active');
        const tabId = tab.dataset.tab + '-tab';
        document.getElementById(tabId).classList.add('active');
    });
});

// Handle GBFS file input (multiple files)
document.getElementById('gbfsFileInput').addEventListener('change', async function(e) {
    const files = e.target.files;
    if (files && files.length > 0) {
        try {
            const discovery = await gbfsLoader.loadFromFiles(files);
            await loadGBFSSystem(gbfsLoader.gbfsData, 'LOCAL_FILES');
        } catch (error) {
            const errorMessage = document.getElementById('errorMessage');
            errorMessage.textContent = `Error loading files: ${error.message}`;
            errorMessage.classList.add('active');
        }
    }
});

// Handle URL loading
document.getElementById('loadFromUrl').addEventListener('click', async function() {
    const url = document.getElementById('gbfsUrlInput').value.trim();
    if (!url) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = 'Please enter a GBFS URL';
        errorMessage.classList.add('active');
        return;
    }

    try {
        const discovery = await gbfsLoader.loadFromPath(url);
        await loadGBFSSystem(gbfsLoader.gbfsData, url);
    } catch (error) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = `Error loading from URL: ${error.message}`;
        errorMessage.classList.add('active');
    }
});

// Allow Enter key to trigger URL loading
document.getElementById('gbfsUrlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('loadFromUrl').click();
    }
});

// Page is ready for user to load GBFS data
console.log('GBFS Visualizer ready - load from URL or select multiple local files');