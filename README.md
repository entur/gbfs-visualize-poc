# GBFS System Visualizer

A web-based tool for visualizing and exploring General Bikeshare Feed Specification (GBFS) data on an interactive map.

## 🌊 Project Vibe

This is a **vibe-coded proof of concept** – built with curiosity and experimentation in mind! The goal is to explore the best ways to dive into GBFS data, gather feedback from the community, and figure out what visualizations and interactions are most valuable for understanding bikeshare systems.

We're learning as we go, so expect rough edges, creative solutions, and room for improvement. Your feedback and ideas are essential to shaping where this goes next!

## Features

- **Interactive Map**: Explore bikeshare systems on a zoomable, pannable Leaflet map
- **Multiple Data Sources**: Load GBFS data from live URLs or local JSON files
- **Comprehensive Data Display**:
  - Physical and virtual stations with availability status
  - Vehicle locations and status (clustered for performance)
  - Geofencing zones with different rule types
  - Pricing plans with contextual display
- **Deep Linking**: Share specific GBFS systems via URL parameters
- **Layer Controls**: Toggle visibility of different data types
- **Real-time Information**: Station and vehicle popups show current availability and pricing

## Supported GBFS Features

### Core Feeds
- `system_information` - Basic system details
- `station_information` - Station locations and properties
- `station_status` - Real-time station availability
- `vehicle_status` - Real-time vehicle locations and status
- `vehicle_types` - Vehicle type definitions
- `geofencing_zones` - Geographic boundaries with rules
- `system_pricing_plans` - Pricing information

### Advanced Features
- Virtual stations (area-based stations)
- Vehicle clustering for performance
- Contextual pricing display per vehicle type
- Unusual pricing structure detection
- Multi-language support for names and descriptions

## Usage

### Loading Data

**Option 1: Search Public Systems**
1. Click "Load Systems Catalog" to fetch the MobilityData registry
2. Search by name, location, or country code
3. Click on any system to load it automatically
4. Systems with v3.0 support are highlighted

**Option 2: From URL (Direct Link)**
1. Enter a GBFS discovery URL (e.g., `https://example.com/gbfs.json`)
2. Click "Load from URL"
3. Use the copy button (📋) to share the visualization

**Option 3: From Local Files**
1. Select multiple JSON files including:
   - `gbfs.json` (discovery file)
   - Feed files like `station_information.json`, `vehicle_status.json`, etc.
2. Files will be loaded automatically

### Navigation

- **Tabs**: Switch between Load, Layers, and Info sections
- **Layer Controls**: Toggle visibility of stations, vehicles, and zones
- **Map Legend**: Understand symbols and colors used on the map
- **Popups**: Click on stations, vehicles, or zones for detailed information

### Pricing Information

The visualizer shows contextual pricing information:
- **Station popups**: Display pricing for available vehicle types
- **Vehicle popups**: Show pricing for the specific vehicle type
- **Unusual structures**: Automatically detects and flags non-standard pricing (e.g., registration fees vs unlock fees)

## Technical Details

### Built With
- **Leaflet.js** - Interactive mapping
- **Leaflet.markercluster** - Vehicle clustering
- Vanilla JavaScript (no framework dependencies)

### Browser Support
Modern browsers supporting ES6+ features including:
- Chrome/Edge 60+
- Firefox 55+
- Safari 10.1+

### Performance
- Automatic vehicle clustering prevents performance issues with large fleets
- Virtual station areas switch between centroids and full polygons based on zoom level
- Efficient data loading and caching

## GBFS Specification

This tool supports GBFS v3.0 specification. For more information about GBFS:
- [GBFS Specification](https://gbfs.mobilitydata.org/)
- [MobilityData GBFS Repository](https://github.com/MobilityData/gbfs)

## File Structure

```
├── index.html          # Main HTML file with UI and styling
├── gbfs-loader.js      # GBFS data loading and processing
├── visualizer.js       # Map visualization and interaction logic
├── gbfs-json-schema/   # GBFS JSON schema files for validation
└── README.md          # This file
```

## Development

This is a client-side web application. To run locally:

1. Clone/download the repository
2. Serve the files via a web server (required for loading local files)
3. Open `index.html` in your browser

Example using Python:
```bash
python -m http.server 8000
# Visit http://localhost:8000
```

## Contributing & Feedback

Since this is a POC exploring how to best work with GBFS data, we're especially interested in:

- **What works?** What visualizations or interactions help you understand the data?
- **What's missing?** What would make this more useful for your needs?
- **What's confusing?** Where does the GBFS data not make sense?
- **Wild ideas!** How else could we visualize or interact with bikeshare data?

Feel free to:
- Open issues with feedback, ideas, or questions
- Share interesting GBFS feeds to test
- Suggest better ways to handle edge cases
- Contribute experimental features

The visualizer aims to support the full GBFS specification, but we're open to creative interpretations!

## License

This project is licensed under the European Union Public Licence (EUPL) v1.2. See the [LICENSE](LICENSE) file for details.