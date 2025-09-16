// Initialize the map with world view
const map = L.map('map').setView([20, 0], 3); // World view centered on equator, no repetition

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
    virtualStationZoomThreshold: 14
};

// Virtual station display state
let currentVirtualDisplayMode = null; // 'centroid' or 'polygon'
let zoomDebounceTimeout = null;

// Optimized zoom event handler with debouncing and threshold detection
map.on('zoomend', function() {
    // Clear any pending debounced refresh
    if (zoomDebounceTimeout) {
        clearTimeout(zoomDebounceTimeout);
    }

    // Debounce the refresh to avoid multiple rapid calls
    zoomDebounceTimeout = setTimeout(() => {
        const currentZoom = map.getZoom();

        // Vehicles are now always visible thanks to clustering - no need to hide them

        // Only refresh virtual stations if we cross the threshold
        const newDisplayMode = currentZoom < performanceSettings.virtualStationZoomThreshold ? 'centroid' : 'polygon';
        if (currentVirtualDisplayMode !== newDisplayMode) {
            currentVirtualDisplayMode = newDisplayMode;
            refreshVirtualStationDisplay();
        }
    }, 150); // 150ms debounce
});

// Optimized virtual station display refresh - only processes virtual stations
function refreshVirtualStationDisplay() {
    if (!stationData || stationData.length === 0) return;

    const currentZoom = map.getZoom();
    const virtualStationsToProcess = stationData.filter(item =>
        item.station.is_virtual_station && item.station.station_area
    );

    if (virtualStationsToProcess.length === 0) return;

    console.log(`Refreshing ${virtualStationsToProcess.length} virtual stations for zoom ${currentZoom}`);

    // Use requestAnimationFrame to batch DOM updates
    requestAnimationFrame(() => {
        virtualStationsToProcess.forEach(stationItem => {
            const station = stationItem.station;
            const status = stationItem.status;

            // Remove current marker/polygon
            layers.stations.removeLayer(stationItem.marker);

            // Pre-calculate values once
            if (!stationItem._cachedData) {
                stationItem._cachedData = {
                    popupContent: createVirtualStationPopup(station, status),
                    centroid: calculatePolygonCentroid(station.station_area.coordinates),
                    latLngs: station.station_area.coordinates.map(polygon =>
                        polygon.map(ring =>
                            ring.map(coord => [coord[1], coord[0]])
                        )
                    )
                };
            }

            let newMapElement;

            // Switch between centroid and polygon based on zoom
            if (currentZoom < performanceSettings.virtualStationZoomThreshold) {
                newMapElement = L.marker(stationItem._cachedData.centroid, {
                    icon: createStationIcon(status, true)
                });
            } else {
                const style = getVirtualStationStyle(status, currentZoom);
                newMapElement = L.polygon(stationItem._cachedData.latLngs, style);

                // Add hover effects
                newMapElement.on('mouseover', function(e) {
                    const layer = e.target;
                    layer.setStyle({
                        weight: style.weight + 2,
                        fillOpacity: style.fillOpacity + 0.2
                    });
                });

                newMapElement.on('mouseout', function(e) {
                    const layer = e.target;
                    layer.setStyle(style);
                });
            }

            newMapElement.bindPopup(stationItem._cachedData.popupContent);
            newMapElement.addTo(layers.stations);

            // Update the stored reference
            stationItem.marker = newMapElement;
        });
    });
}

// Create cached popup content for virtual stations
function createVirtualStationPopup(station, status) {
    let popupContent = `<div class="popup-content">`;
    popupContent += `<h4>${station.name[0].text}</h4>`;
    popupContent += `<div><strong>ID:</strong> ${station.station_id}</div>`;
    popupContent += `<div><strong>Type:</strong> Virtual Station (Area)</div>`;

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

    if (station.address) {
        popupContent += `<div><strong>Address:</strong> ${station.address}</div>`;
    }

    // Add pricing information for available vehicle types (only if vehicles are actually available)
    if (status && status.vehicle_types_available && status.vehicle_types_available.length > 0 &&
        status.vehicle_types_available.some(vt => vt.count > 0)) {
        popupContent += `<div style="background: #e8f5e8; padding: 6px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #4CAF50;">`;
        popupContent += `<div style="font-weight: 500; color: #2E7D32; font-size: 12px;">💰 Available Vehicle Pricing</div>`;

        status.vehicle_types_available.forEach(vehicleTypeStatus => {
            // Only show vehicle types that actually have vehicles available
            if (vehicleTypeStatus.count > 0) {
                const vehicleTypeName = getVehicleTypeName(vehicleTypeStatus.vehicle_type_id);
                const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicleTypeStatus.vehicle_type_id);

                if (vehicleType && vehicleType.default_pricing_plan_id) {
                    const pricingInfo = formatPricingInfo(vehicleType.default_pricing_plan_id).substring(3); // Remove " • " prefix
                    if (pricingInfo) {
                        popupContent += `<div style="color: #388E3C; font-size: 11px; margin: 2px 0;">`;
                        popupContent += `<strong>${vehicleTypeName.split('(')[0].trim()}</strong> (${vehicleTypeStatus.count} available): ${pricingInfo}`;
                        popupContent += `</div>`;
                    }
                }
            }
        });

        popupContent += `</div>`;
    } else if (station.vehicle_types_capacity && station.vehicle_types_capacity.length > 0 &&
              status && status.num_vehicles_available > 0) {
        // Only show pricing fallback if we know there are vehicles available (but no detailed breakdown)
        popupContent += `<div style="background: #e8f5e8; padding: 6px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #4CAF50;">`;
        popupContent += `<div style="font-weight: 500; color: #2E7D32; font-size: 12px;">💰 Vehicle Type Pricing</div>`;

        station.vehicle_types_capacity.forEach(vehicleTypeCapacity => {
            vehicleTypeCapacity.vehicle_type_ids.forEach(vehicleTypeId => {
                const vehicleTypeName = getVehicleTypeName(vehicleTypeId);
                const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicleTypeId);

                if (vehicleType && vehicleType.default_pricing_plan_id) {
                    const pricingInfo = formatPricingInfo(vehicleType.default_pricing_plan_id).substring(3); // Remove " • " prefix
                    if (pricingInfo) {
                        popupContent += `<div style="color: #388E3C; font-size: 11px; margin: 2px 0;">`;
                        popupContent += `<strong>${vehicleTypeName.split('(')[0].trim()}</strong>: ${pricingInfo}`;
                        popupContent += `</div>`;
                    }
                }
            });
        });

        popupContent += `</div>`;
    }

    popupContent += `</div>`;
    return popupContent;
}

// GBFS Loader instance
const gbfsLoader = new GBFSLoader();

// Helper function to show error messages
function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorMessage.classList.add('active');
}

// Deep link functionality - load system from URL parameter
function checkForDeepLink() {
    const urlParams = new URLSearchParams(window.location.search);
    const gbfsUrl = urlParams.get('gbfs') || urlParams.get('url');

    if (gbfsUrl) {
        console.log('Deep link detected, loading system:', gbfsUrl);

        // Validate URL format
        try {
            new URL(gbfsUrl);

            // Set the URL input field and load the system
            const urlInput = document.getElementById('gbfsUrlInput');
            if (urlInput) {
                urlInput.value = gbfsUrl;

                // Trigger the input event to enable copy button
                urlInput.dispatchEvent(new Event('input'));

                // Auto-load the system
                loadGBFSFromUrl();
            }
        } catch (error) {
            console.error('Invalid GBFS URL in deep link:', gbfsUrl);
            showError(`Invalid GBFS URL in link: ${gbfsUrl}`);
        }
    }
}

// Update URL parameters
function updateUrlParameters(gbfsUrl) {
    const currentUrl = new URL(window.location.href);
    if (gbfsUrl && gbfsUrl.trim()) {
        currentUrl.searchParams.set('gbfs', gbfsUrl);
    } else {
        currentUrl.searchParams.delete('gbfs');
    }
    // Update browser history without triggering a reload
    window.history.replaceState({}, '', currentUrl.toString());
}

// Generate shareable link for current system
function generateShareableLink() {
    const urlInput = document.getElementById('gbfsUrlInput');
    if (!urlInput || !urlInput.value) {
        return null;
    }

    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set('gbfs', urlInput.value);
    return currentUrl.toString();
}

// Shared function for loading GBFS from URL
async function loadGBFSFromUrl() {
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

        // Update copy button state
        const copyButton = document.getElementById('copyLinkButton');
        copyButton.disabled = false;
        copyButton.style.background = '#6c757d';
    } catch (error) {
        const errorMessage = document.getElementById('errorMessage');
        errorMessage.textContent = `Error loading from URL: ${error.message}`;
        errorMessage.classList.add('active');
    }
}

// Store for all data
let allZones = [];
let stationData = [];
let vehicleData = [];
let vehicleTypesData = [];
let pricingPlansData = [];

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

// Analyze vehicle type precedence across overlapping zones
function analyzeVehicleTypePrecedence(features) {
    const vehicleTypeRules = new Map();

    // Collect all unique vehicle types and universal rules
    features.forEach((feature, zoneIndex) => {
        if (!feature.properties.rules) return;

        feature.properties.rules.forEach((rule, ruleIndex) => {
            const vehicleTypes = rule.vehicle_type_ids && rule.vehicle_type_ids.length > 0
                ? rule.vehicle_type_ids
                : ['*']; // '*' represents universal rules (no vehicle_type_ids specified)

            vehicleTypes.forEach(vehicleType => {
                if (!vehicleTypeRules.has(vehicleType)) {
                    vehicleTypeRules.set(vehicleType, []);
                }

                vehicleTypeRules.get(vehicleType).push({
                    zoneIndex,
                    ruleIndex,
                    zoneName: feature.properties.name?.[0]?.text || `Zone ${zoneIndex + 1}`,
                    rule,
                    precedenceScore: zoneIndex * 1000 + ruleIndex // Lower is higher precedence
                });
            });
        });
    });

    // Sort rules by precedence for each vehicle type
    vehicleTypeRules.forEach((rules, vehicleType) => {
        rules.sort((a, b) => a.precedenceScore - b.precedenceScore);
    });

    return vehicleTypeRules;
}

// Create popup content for overlapping zones with vehicle type precedence
function createZonePopupContent(features) {
    let html = `<div class="popup-content">`;

    if (features.length === 1) {
        html += createZoneInfo(features[0]);
    } else {
        html += `<h4 style="color: #ff6b6b;">⚠ ${features.length} Overlapping Zones</h4>`;

        // Analyze vehicle type precedence
        const vehicleTypePrecedence = analyzeVehicleTypePrecedence(features);
        const hasVehicleSpecificRules = Array.from(vehicleTypePrecedence.keys()).some(key => key !== '*');

        if (hasVehicleSpecificRules) {
            // Show vehicle type specific precedence analysis
            html += `<div style="background: #e3f2fd; border: 1px solid #2196f3; border-radius: 4px; padding: 8px; margin-bottom: 10px; font-size: 12px;">`;
            html += `<strong>🚲 Vehicle Type Precedence Analysis:</strong><br>`;
            html += `Different rules may apply to different vehicle types. The highest precedence rule for each type is shown below.`;
            html += `</div>`;

            // Create tabs or sections for each vehicle type
            html += `<div style="margin-bottom: 15px;">`;
            vehicleTypePrecedence.forEach((rules, vehicleType) => {
                const highestPrecedenceRule = rules[0];
                const vehicleTypeLabel = vehicleType === '*' ? 'All Vehicle Types' : `Vehicle Type: ${getVehicleTypeName(vehicleType)}`;

                html += `<div style="background: #f8f9fa; border-left: 4px solid #007bff; padding: 8px; margin-bottom: 8px; border-radius: 0 4px 4px 0;">`;
                html += `<div style="font-weight: bold; color: #007bff; font-size: 12px; margin-bottom: 4px;">${vehicleTypeLabel}</div>`;
                html += `<div style="font-size: 11px; color: #666;">Highest precedence from: <strong>${highestPrecedenceRule.zoneName}</strong></div>`;

                // Show the winning rule details
                html += `<div style="margin-top: 6px; font-size: 11px;">`;
                html += `<span style="color: ${highestPrecedenceRule.rule.ride_start_allowed ? '#28a745' : '#dc3545'};">Start: ${highestPrecedenceRule.rule.ride_start_allowed ? '✓' : '✗'}</span> | `;
                html += `<span style="color: ${highestPrecedenceRule.rule.ride_end_allowed ? '#28a745' : '#dc3545'};">End: ${highestPrecedenceRule.rule.ride_end_allowed ? '✓' : '✗'}</span> | `;
                html += `<span style="color: ${highestPrecedenceRule.rule.ride_through_allowed ? '#28a745' : '#dc3545'};">Through: ${highestPrecedenceRule.rule.ride_through_allowed ? '✓' : '✗'}</span>`;

                if (highestPrecedenceRule.rule.maximum_speed_kph !== undefined) {
                    html += ` | <span style="color: #ffc107;">Max Speed: ${highestPrecedenceRule.rule.maximum_speed_kph} km/h</span>`;
                }
                if (highestPrecedenceRule.rule.station_parking) {
                    html += ` | <span style="color: #17a2b8;">Station Parking Required</span>`;
                }
                html += `</div>`;

                // Show competing rules if any
                if (rules.length > 1) {
                    html += `<div style="font-size: 10px; color: #6c757d; margin-top: 4px;">`;
                    html += `${rules.length - 1} lower precedence rule(s) also apply to this vehicle type.`;
                    html += `</div>`;
                }

                html += `</div>`;
            });
            html += `</div>`;
        } else {
            // Original simple precedence explanation for universal rules only
            html += `<div style="background: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 8px; margin-bottom: 10px; font-size: 12px;">`;
            html += `<strong>🔍 Rule Precedence:</strong><br>`;
            html += `Rules from the <strong>first zone</strong> below take precedence in overlapping areas. `;
            html += `Within each zone, earlier rules take precedence over later ones.`;
            html += `</div>`;
        }

        // Show all zones for reference
        html += `<div style="border-top: 1px solid #dee2e6; padding-top: 15px;">`;
        html += `<h5 style="margin: 0 0 10px 0; color: #495057; font-size: 14px;">All Overlapping Zones:</h5>`;
        html += `<div style="max-height: 300px; overflow-y: auto;">`;

        features.forEach((feature, index) => {
            if (index > 0) {
                html += `<hr style="margin: 15px 0; border: none; border-top: 1px solid #eee;">`;
            }

            html += `<div style="padding: 5px 0;">`;
            html += `<div style="font-size: 11px; color: #666; font-weight: bold; margin-bottom: 5px;">`;
            html += `Zone #${index + 1} (${hasVehicleSpecificRules ? 'See analysis above for precedence' : index === 0 ? 'Highest Precedence' : 'Lower Precedence'})`;
            html += `</div>`;
            html += createZoneInfo(feature);
            html += `</div>`;
        });
        html += `</div>`;
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
function createStationIcon(status, isVirtualCentroid = false) {
    const available = status ? status.num_vehicles_available || 0 : 0;
    const color = available > 0 ? '#4CAF50' : '#FF9800';

    if (isVirtualCentroid) {
        // Special icon for virtual station centroids with vehicle count
        const displayCount = available > 99 ? '99+' : available.toString();
        return L.divIcon({
            className: 'virtual-station-centroid',
            html: `<div style="background: ${color}; border: 2px solid white; border-radius: 50%; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white; box-shadow: 0 0 6px rgba(0,0,0,0.4);">${available > 0 ? displayCount : '0'}</div>`,
            iconSize: [20, 20],
            iconAnchor: [10, 10]
        });
    }

    return L.divIcon({
        className: 'station-marker',
        html: `<div style="width: 12px; height: 12px; background: ${color}; border: 2px solid white; border-radius: 50%; box-shadow: 0 0 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
}

// Calculate centroid of a polygon
function calculatePolygonCentroid(coordinates) {
    // Use the first ring of the first polygon for centroid calculation
    const ring = coordinates[0][0];
    let x = 0, y = 0;

    for (const coord of ring) {
        x += coord[0]; // longitude
        y += coord[1]; // latitude
    }

    return [y / ring.length, x / ring.length]; // Return as [lat, lng]
}

// Get virtual station styling based on availability and zoom level
function getVirtualStationStyle(status, currentZoom = map.getZoom()) {
    const available = status ? status.num_vehicles_available || 0 : 0;
    const baseColor = available > 0 ? '#4CAF50' : '#FF9800';

    // Make styling more prominent at lower zoom levels
    const isLowZoom = currentZoom < 16;
    const weight = isLowZoom ? 4 : 3;
    const fillOpacity = isLowZoom ? 0.8 : 0.6;
    const dashArray = isLowZoom ? '10, 6' : '8, 4';

    return {
        color: baseColor,
        fillColor: available > 0 ? 'rgba(76, 175, 80, 0.4)' : 'rgba(255, 152, 0, 0.4)',
        fillOpacity: fillOpacity,
        weight: weight,
        dashArray: dashArray,
        // Add a subtle glow effect
        className: 'virtual-station-area'
    };
}

// Load and display stations (both physical and virtual)
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

            // Create popup content (shared between physical and virtual stations)
            let popupContent = `<div class="popup-content">`;
            popupContent += `<h4>${station.name[0].text}</h4>`;
            popupContent += `<div><strong>ID:</strong> ${station.station_id}</div>`;
            popupContent += `<div><strong>Type:</strong> ${station.is_virtual_station ? 'Virtual Station (Area)' : 'Physical Station'}</div>`;

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

            if (station.address) {
                popupContent += `<div><strong>Address:</strong> ${station.address}</div>`;
            }

            // Add pricing information for available vehicle types (only if vehicles are actually available)
            if (status && status.vehicle_types_available && status.vehicle_types_available.length > 0 &&
                status.vehicle_types_available.some(vt => vt.count > 0)) {
                popupContent += `<div style="background: #e8f5e8; padding: 6px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #4CAF50;">`;
                popupContent += `<div style="font-weight: 500; color: #2E7D32; font-size: 12px;">💰 Available Vehicle Pricing</div>`;

                status.vehicle_types_available.forEach(vehicleTypeStatus => {
                    // Only show vehicle types that actually have vehicles available
                    if (vehicleTypeStatus.count > 0) {
                        const vehicleTypeName = getVehicleTypeName(vehicleTypeStatus.vehicle_type_id);
                        const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicleTypeStatus.vehicle_type_id);


                        if (vehicleType && vehicleType.default_pricing_plan_id) {
                            const pricingInfo = formatPricingInfo(vehicleType.default_pricing_plan_id);
                            const cleanPricingInfo = pricingInfo.substring(3); // Remove " • " prefix

                            if (cleanPricingInfo) {
                                popupContent += `<div style="color: #388E3C; font-size: 11px; margin: 2px 0;">`;
                                popupContent += `<strong>${vehicleTypeName.split('(')[0].trim()}</strong> (${vehicleTypeStatus.count} available): ${cleanPricingInfo}`;

                                // Add explanation for unusual pricing structure
                                if (cleanPricingInfo.includes('⚠️')) {
                                    popupContent += `<div style="color: #ff8c00; font-size: 10px; font-style: italic; margin-left: 10px;">`;
                                    popupContent += `⚠️ Unusual pricing: registration fee + per-trip costs`;
                                    popupContent += `</div>`;
                                }

                                popupContent += `</div>`;
                            }
                        }
                    }
                });

                popupContent += `</div>`;
            } else if (station.vehicle_types_capacity && station.vehicle_types_capacity.length > 0 &&
                      status && status.num_vehicles_available > 0) {
                // Only show pricing fallback if we know there are vehicles available (but no detailed breakdown)
                popupContent += `<div style="background: #e8f5e8; padding: 6px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #4CAF50;">`;
                popupContent += `<div style="font-weight: 500; color: #2E7D32; font-size: 12px;">💰 Vehicle Type Pricing</div>`;

                station.vehicle_types_capacity.forEach(vehicleTypeCapacity => {
                    vehicleTypeCapacity.vehicle_type_ids.forEach(vehicleTypeId => {
                        const vehicleTypeName = getVehicleTypeName(vehicleTypeId);
                        const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicleTypeId);

                        if (vehicleType && vehicleType.default_pricing_plan_id) {
                            const pricingInfo = formatPricingInfo(vehicleType.default_pricing_plan_id).substring(3); // Remove " • " prefix
                            if (pricingInfo) {
                                popupContent += `<div style="color: #388E3C; font-size: 11px; margin: 2px 0;">`;
                                popupContent += `<strong>${vehicleTypeName.split('(')[0].trim()}</strong>: ${pricingInfo}`;
                                popupContent += `</div>`;
                            }
                        }
                    });
                });

                popupContent += `</div>`;
            }

            popupContent += `</div>`;

            let mapElement;
            const currentZoom = map.getZoom();

            // Handle virtual stations with areas
            if (station.is_virtual_station && station.station_area) {
                // Convert MultiPolygon coordinates to Leaflet format
                const latLngs = station.station_area.coordinates.map(polygon =>
                    polygon.map(ring =>
                        ring.map(coord => [coord[1], coord[0]]) // Swap lng/lat to lat/lng
                    )
                );

                // Get styling based on vehicle availability
                const style = getVirtualStationStyle(status);

                // At low zoom levels, show centroid with vehicle count
                if (currentZoom < 14) {
                    const centroid = calculatePolygonCentroid(station.station_area.coordinates);
                    mapElement = L.marker(centroid, {
                        icon: createStationIcon(status, true)
                    });
                } else {
                    // At high zoom levels, show full polygon area
                    mapElement = L.polygon(latLngs, style);

                    // Add a subtle animation on hover
                    mapElement.on('mouseover', function(e) {
                        const layer = e.target;
                        layer.setStyle({
                            weight: style.weight + 2,
                            fillOpacity: style.fillOpacity + 0.2
                        });
                    });

                    mapElement.on('mouseout', function(e) {
                        const layer = e.target;
                        layer.setStyle(style);
                    });
                }

                mapElement.bindPopup(popupContent);
                mapElement.addTo(layers.stations);

            } else if (station.lat !== undefined && station.lon !== undefined) {
                // Handle physical stations with point locations
                mapElement = L.marker([station.lat, station.lon], {
                    icon: createStationIcon(status)
                });

                mapElement.bindPopup(popupContent);
                mapElement.addTo(layers.stations);

            } else {
                console.warn(`Station ${station.station_id} has no location data (neither lat/lon nor station_area)`);
                return; // Skip this station
            }

            stationData.push({
                station: station,
                status: status,
                marker: mapElement
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

        // Vehicles are always loaded - clustering handles performance automatically

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
                    const vehicleTypeName = getVehicleTypeName(vehicle.vehicle_type_id);
                    popupContent += `<div><strong>Type:</strong> ${vehicleTypeName}</div>`;
                }

                // Add pricing information - check both vehicle-specific and vehicle type default pricing
                let pricingPlanId = null;

                // First check if vehicle has its own pricing_plan_id
                if (vehicle.pricing_plan_id) {
                    pricingPlanId = vehicle.pricing_plan_id;
                }
                // Otherwise use the vehicle type's default pricing plan
                else if (vehicle.vehicle_type_id) {
                    const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicle.vehicle_type_id);
                    if (vehicleType && vehicleType.default_pricing_plan_id) {
                        pricingPlanId = vehicleType.default_pricing_plan_id;
                    }
                }

                if (pricingPlanId) {
                    const pricingInfo = formatPricingInfo(pricingPlanId).substring(3); // Remove " • " prefix
                    if (pricingInfo) {
                        popupContent += `<div style="background: #e8f5e8; padding: 6px; border-radius: 4px; margin: 8px 0; border-left: 3px solid #4CAF50;">`;
                        popupContent += `<div style="font-weight: 500; color: #2E7D32; font-size: 12px;">💰 Pricing</div>`;
                        popupContent += `<div style="color: #388E3C; font-size: 11px;">${pricingInfo}</div>`;

                        // Add explanation for unusual pricing structure
                        if (pricingInfo.includes('⚠️')) {
                            popupContent += `<div style="color: #ff8c00; font-size: 10px; font-style: italic; margin-top: 4px;">`;
                            popupContent += `⚠️ Unusual pricing: registration fee + per-trip costs`;
                            popupContent += `</div>`;
                        }

                        // Note if this is vehicle-specific pricing
                        if (vehicle.pricing_plan_id) {
                            popupContent += `<div style="color: #666; font-size: 9px; font-style: italic; margin-top: 4px;">`;
                            popupContent += `Vehicle-specific pricing`;
                            popupContent += `</div>`;
                        }

                        popupContent += `</div>`;
                    }
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

// Load and store vehicle types data
function loadVehicleTypes(data) {
    vehicleTypesData = [];

    try {
        if (!data || !data.data || !data.data.vehicle_types) {
            console.log('No vehicle types data found');
            return;
        }

        vehicleTypesData = data.data.vehicle_types;
        console.log(`Loaded ${vehicleTypesData.length} vehicle types`);

    } catch (error) {
        console.error('Error loading vehicle types:', error);
        throw error;
    }
}

// Load and store pricing plans data
function loadPricingPlans(data) {
    pricingPlansData = [];

    try {
        if (!data || !data.data || !data.data.plans) {
            console.log('No pricing plans data found');
            return;
        }

        pricingPlansData = data.data.plans;
        console.log(`Loaded ${pricingPlansData.length} pricing plans`);

    } catch (error) {
        console.error('Error loading pricing plans:', error);
        throw error;
    }
}

// Get pricing plan by ID
function getPricingPlan(planId) {
    if (!pricingPlansData || pricingPlansData.length === 0) {
        return null;
    }

    return pricingPlansData.find(plan => plan.plan_id === planId);
}

// Format pricing information for display
function formatPricingInfo(planId) {
    const plan = getPricingPlan(planId);
    if (!plan) return '';

    const parts = [];
    let hasUnusualStructure = false;

    // Detect unusual pricing structure: price field + per_min_pricing with interval: 0
    const hasRegistrationFee = plan.price && plan.price > 0;
    const hasUnlockInPerMin = plan.per_min_pricing &&
                              plan.per_min_pricing.some(segment => segment.interval === 0);

    if (hasRegistrationFee && hasUnlockInPerMin) {
        hasUnusualStructure = true;

        // Registration fee (one-time)
        parts.push(`${plan.price} ${plan.currency} registration`);

        // Find unlock fee (interval: 0) and per-minute rate (interval > 0)
        const unlockSegment = plan.per_min_pricing.find(segment => segment.interval === 0);
        const perMinSegment = plan.per_min_pricing.find(segment => segment.interval > 0);

        if (unlockSegment) {
            parts.push(`${unlockSegment.rate} ${plan.currency} unlock`);
        }

        if (perMinSegment) {
            parts.push(`${perMinSegment.rate} ${plan.currency}/min`);
        }
    } else {
        // Standard pricing structure

        // Base price (standard unlock fee)
        if (plan.price && plan.price > 0) {
            parts.push(`${plan.price} ${plan.currency} unlock`);
        }

        // Per minute pricing - find the main recurring rate (interval > 0)
        if (plan.per_min_pricing && plan.per_min_pricing.length > 0) {
            // Look for a segment with interval > 0 (recurring pricing)
            const recurringSegment = plan.per_min_pricing.find(segment => segment.interval > 0);
            const perMin = recurringSegment || plan.per_min_pricing[0]; // Fallback to first segment
            parts.push(`${perMin.rate} ${plan.currency}/min`);
        }
    }

    // Per km pricing
    if (plan.per_km_pricing && plan.per_km_pricing.length > 0) {
        const perKm = plan.per_km_pricing[0]; // Use first segment
        parts.push(`${perKm.rate} ${plan.currency}/km`);
    }

    // Surge pricing indicator
    if (plan.surge_pricing) {
        parts.push('⚡ Surge pricing');
    }

    let result = parts.length > 0 ? ` • ${parts.join(' + ')}` : '';

    // Add unusual structure flag
    if (hasUnusualStructure) {
        result += ' ⚠️';
    }

    return result;
}

// Get vehicle type name by ID with rich metadata
function getVehicleTypeName(vehicleTypeId) {
    if (!vehicleTypesData || vehicleTypesData.length === 0) {
        return vehicleTypeId; // Return ID if no vehicle types data
    }

    const vehicleType = vehicleTypesData.find(vt => vt.vehicle_type_id === vehicleTypeId);
    if (!vehicleType) {
        return vehicleTypeId; // Return ID if vehicle type not found
    }

    // Build a descriptive label
    let label = '';

    // Start with name if available
    if (vehicleType.name && vehicleType.name.length > 0) {
        label = vehicleType.name[0].text;
    }

    // Add form factor and propulsion type for clarity
    const formFactorLabels = {
        'bicycle': 'Bicycle',
        'cargo_bicycle': 'Cargo Bicycle',
        'car': 'Car',
        'moped': 'Moped',
        'scooter_standing': 'Standing Scooter',
        'scooter_seated': 'Seated Scooter',
        'scooter': 'Scooter',
        'other': 'Other Vehicle'
    };

    const propulsionLabels = {
        'human': 'Pedal',
        'electric_assist': 'E-Assist',
        'electric': 'Electric',
        'combustion': 'Combustion',
        'combustion_diesel': 'Diesel',
        'hybrid': 'Hybrid',
        'plug_in_hybrid': 'Plug-in Hybrid',
        'hydrogen_fuel_cell': 'Hydrogen'
    };

    const formFactor = formFactorLabels[vehicleType.form_factor] || vehicleType.form_factor;
    const propulsion = propulsionLabels[vehicleType.propulsion_type] || vehicleType.propulsion_type;

    // Create descriptive parts
    const parts = [];

    if (propulsion !== 'Pedal') { // Don't add "Pedal" for human-powered bikes
        parts.push(propulsion);
    }

    parts.push(formFactor);

    // Add range if available and electric/hybrid
    if (vehicleType.max_range_meters &&
        ['electric', 'electric_assist', 'hybrid', 'plug_in_hybrid'].includes(vehicleType.propulsion_type)) {
        const rangeKm = Math.round(vehicleType.max_range_meters / 1000);
        parts.push(`${rangeKm}km range`);
    }

    const typeDescription = parts.join(' ');

    // Check if we need to add ID for uniqueness
    const duplicateNames = vehicleTypesData.filter(vt => {
        if (!vt.name || vt.name.length === 0) return false;
        const otherName = vt.name[0].text;
        const otherFormFactor = formFactorLabels[vt.form_factor] || vt.form_factor;
        const otherPropulsion = propulsionLabels[vt.propulsion_type] || vt.propulsion_type;

        const otherParts = [];
        if (otherPropulsion !== 'Pedal') {
            otherParts.push(otherPropulsion);
        }
        otherParts.push(otherFormFactor);

        if (vt.max_range_meters &&
            ['electric', 'electric_assist', 'hybrid', 'plug_in_hybrid'].includes(vt.propulsion_type)) {
            const otherRangeKm = Math.round(vt.max_range_meters / 1000);
            otherParts.push(`${otherRangeKm}km range`);
        }

        return otherParts.join(' ') === typeDescription;
    });

    // Add pricing information if available
    const pricingInfo = vehicleType.default_pricing_plan_id
        ? formatPricingInfo(vehicleType.default_pricing_plan_id)
        : '';

    if (label && typeDescription !== label) {
        // Show both name and type description if they're different
        if (duplicateNames.length > 1) {
            return `${label} (${typeDescription})${pricingInfo} [${vehicleTypeId.split(':').pop() || vehicleTypeId}]`;
        } else {
            return `${label} (${typeDescription})${pricingInfo}`;
        }
    } else if (label) {
        // Just the name, but add ID if there are duplicates with same name
        if (duplicateNames.length > 1) {
            return `${label}${pricingInfo} [${vehicleTypeId.split(':').pop() || vehicleTypeId}]`;
        } else {
            return `${label}${pricingInfo}`;
        }
    } else {
        // No name available, use type description
        if (duplicateNames.length > 1) {
            return `${typeDescription}${pricingInfo} [${vehicleTypeId.split(':').pop() || vehicleTypeId}]`;
        } else {
            return `${typeDescription}${pricingInfo}`;
        }
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

    // Pricing information is now shown in station and vehicle popups for better context

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

        // Clear all data arrays
        allZones = [];
        stationData = [];
        vehicleData = [];
        vehicleTypesData = [];
        pricingPlansData = [];

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
            'vehicle_types',
            'system_pricing_plans'
        ].filter(feed => availableFeeds.includes(feed));

        // Update loading indicator with feed count
        const loadingIndicator = document.getElementById('loadingIndicator');
        loadingIndicator.innerHTML = `Loading GBFS data... (${feedsToLoad.length} feeds)`;

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

        // Load vehicle types and pricing plans first, before stations and vehicles (so popups can show pricing)
        if (results.vehicle_types) {
            loadVehicleTypes(results.vehicle_types);
        }

        if (results.system_pricing_plans) {
            loadPricingPlans(results.system_pricing_plans);
        }

        // Now load stations and vehicles (popups can access vehicle types and pricing data)
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
            // Clear URL parameter when loading from files
            updateUrlParameters('');
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
document.getElementById('loadFromUrl').addEventListener('click', loadGBFSFromUrl);

// Allow Enter key to trigger URL loading
document.getElementById('gbfsUrlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('loadFromUrl').click();
    }
});

// Monitor URL input to enable/disable copy link button and update URL parameters
document.getElementById('gbfsUrlInput').addEventListener('input', function(e) {
    const copyButton = document.getElementById('copyLinkButton');
    const hasUrl = e.target.value.trim().length > 0;
    copyButton.disabled = !hasUrl;
    copyButton.style.background = hasUrl ? '#6c757d' : '#e0e0e0';

    // Update URL parameters when input changes
    updateUrlParameters(e.target.value.trim());
});

// Copy link button functionality
document.getElementById('copyLinkButton').addEventListener('click', function() {
    const shareableLink = generateShareableLink();
    if (shareableLink) {
        navigator.clipboard.writeText(shareableLink).then(() => {
            const button = document.getElementById('copyLinkButton');
            const originalText = button.textContent;
            button.textContent = '✓ Copied!';
            button.style.background = '#28a745';

            setTimeout(() => {
                button.textContent = '📋';
                button.style.background = '#6c757d';
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy link:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = shareableLink;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);

            const button = document.getElementById('copyLinkButton');
            button.textContent = '✓ Copied!';
            button.style.background = '#28a745';
            setTimeout(() => {
                button.textContent = '📋';
                button.style.background = '#6c757d';
            }, 2000);
        });
    }
});

// Initialize deep link functionality on page load
document.addEventListener('DOMContentLoaded', function() {
    checkForDeepLink();
});

// Page is ready for user to load GBFS data
console.log('GBFS Visualizer ready - load from URL or select multiple local files');
