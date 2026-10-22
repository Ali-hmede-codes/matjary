import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Lebanon bounding box coordinates
 * Approximate bounds: North: 34.7, South: 33.0, East: 36.7, West: 35.0
 */
export const LEBANON_BOUNDS = {
  north: 34.7,
  south: 33.0,
  east: 36.7,
  west: 35.0,
} as const;

/**
 * Default map center for Lebanon (Beirut)
 */
export const LEBANON_DEFAULT_CENTER = {
  latitude: 33.8938,
  longitude: 35.5018,
  zoom: 10,
} as const;

/**
 * Nominatim API response types
 */
interface NominatimResponse {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address?: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
  boundingbox: [string, string, string, string];
}

interface ReverseGeocodeResponse {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    neighbourhood?: string;
    suburb?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
  address?: string;
  city?: string;
  country?: string;
  postalCode?: string;
}

export interface LocationValidationResult {
  isValid: boolean;
  isInLebanon: boolean;
  coordinates?: { latitude: number; longitude: number };
  error?: string;
}

@Injectable()
export class LocationService {
  private readonly logger = new Logger(LocationService.name);
  private readonly nominatimBaseUrl: string;
  private readonly userAgent: string;
  private readonly requestDelayMs: number;
  private lastRequestTime = 0;

  constructor(private readonly configService: ConfigService) {
    // Use Nominatim (OpenStreetMap) - free, no API key required
    this.nominatimBaseUrl = this.configService.get<string>(
      'NOMINATIM_BASE_URL',
      'https://nominatim.openstreetmap.org',
    );
    this.userAgent = this.configService.get<string>(
      'NOMINATIM_USER_AGENT',
      'Matjary/1.0 (contact@matjary.com)',
    );
    // Nominatim requires max 1 request per second
    this.requestDelayMs = 1100;
  }

  /**
   * Rate limiting for Nominatim API (max 1 request/second)
   */
  private async respectRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.requestDelayMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.requestDelayMs - timeSinceLastRequest),
      );
    }
    this.lastRequestTime = Date.now();
  }

  /**
   * Forward geocoding: Convert address to coordinates
   * Uses Nominatim (OpenStreetMap) - completely free
   */
  async geocodeAddress(address: string): Promise<GeocodeResult | null> {
    try {
      await this.respectRateLimit();

      const params = new URLSearchParams({
        q: address,
        format: 'json',
        limit: '1',
        addressdetails: '1',
        countrycodes: 'lb', // Restrict to Lebanon
        'accept-language': 'en,ar',
      });

      const response = await fetch(
        `${this.nominatimBaseUrl}/search?${params.toString()}`,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Nominatim geocode failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as unknown;
      if (!Array.isArray(data) || data.length === 0) {
        return null;
      }
      const result = data[0] as NominatimResponse;
      return {
        latitude: parseFloat(result.lat),
        longitude: parseFloat(result.lon),
        displayName: result.display_name,
        address: result.address?.road
          ? `${result.address.house_number || ''} ${result.address.road}`.trim()
          : undefined,
        city:
          result.address?.city ||
          result.address?.town ||
          result.address?.village ||
          undefined,
        country: result.address?.country,
        postalCode: result.address?.postcode,
      };
    } catch (error) {
      this.logger.error(`Geocoding error for "${address}":`, error);
      return null;
    }
  }

  /**
   * Reverse geocoding: Convert coordinates to address
   */
  async reverseGeocode(
    latitude: number,
    longitude: number,
  ): Promise<GeocodeResult | null> {
    try {
      await this.respectRateLimit();

      const params = new URLSearchParams({
        lat: latitude.toString(),
        lon: longitude.toString(),
        format: 'json',
        addressdetails: '1',
        'accept-language': 'en,ar',
      });

      const response = await fetch(
        `${this.nominatimBaseUrl}/reverse?${params.toString()}`,
        {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
        },
      );

      if (!response.ok) {
        this.logger.warn(
          `Nominatim reverse geocode failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as unknown;
      const result = data as ReverseGeocodeResponse;
      return {
        latitude,
        longitude,
        displayName: result.display_name,
        address: result.address?.road
          ? `${result.address.house_number || ''} ${result.address.road}`.trim()
          : undefined,
        city:
          result.address?.city ||
          result.address?.town ||
          result.address?.village ||
          undefined,
        country: result.address?.country,
        postalCode: result.address?.postcode,
      };
    } catch (error) {
      this.logger.error(
        `Reverse geocoding error for (${latitude}, ${longitude}):`,
        error,
      );
      return null;
    }
  }

  /**
   * Validate if coordinates are within Lebanon
   */
  validateLocationInLebanon(
    latitude: number,
    longitude: number,
  ): LocationValidationResult {
    // Check if coordinates are valid numbers
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      isNaN(latitude) ||
      isNaN(longitude)
    ) {
      return {
        isValid: false,
        isInLebanon: false,
        error: 'Invalid coordinates',
      };
    }

    // Check if within valid coordinate ranges
    if (
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return {
        isValid: false,
        isInLebanon: false,
        error: 'Coordinates out of valid range',
      };
    }

    // Check if within Lebanon bounds
    const isInLebanon =
      latitude >= LEBANON_BOUNDS.south &&
      latitude <= LEBANON_BOUNDS.north &&
      longitude >= LEBANON_BOUNDS.west &&
      longitude <= LEBANON_BOUNDS.east;

    return {
      isValid: true,
      isInLebanon,
      coordinates: { latitude, longitude },
      error: isInLebanon ? undefined : 'Location is outside Lebanon',
    };
  }

  /**
   * Validate and geocode an address, ensuring it's in Lebanon
   */
  async validateAndGeocodeAddress(
    address: string,
  ): Promise<LocationValidationResult> {
    const result = await this.geocodeAddress(address);
    if (!result) {
      return {
        isValid: false,
        isInLebanon: false,
        error: 'Could not geocode address',
      };
    }

    const validation = this.validateLocationInLebanon(
      result.latitude,
      result.longitude,
    );

    if (!validation.isValid) {
      return validation;
    }

    return {
      ...validation,
      coordinates: { latitude: result.latitude, longitude: result.longitude },
    };
  }

  /**
   * Get OpenStreetMap tile URL for a given zoom level and coordinates
   * Free tile server - no API key required
   */
  getTileUrl(
    z: number,
    x: number,
    y: number,
    style: 'standard' | 'humanitarian' | 'topo' = 'standard',
  ): string {
    const styles = {
      standard: 'https://tile.openstreetmap.org',
      humanitarian: 'https://tile.openstreetmap.fr/hot',
      topo: 'https://tile.opentopomap.org',
    };
    return `${styles[style]}/${z}/${x}/${y}.png`;
  }

  /**
   * Get OpenStreetMap URL for a location (for sharing/embedding)
   */
  getOpenStreetMapUrl(latitude: number, longitude: number, zoom = 16): string {
    return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=${zoom}/${latitude}/${longitude}`;
  }

  /**
   * Get Leaflet-compatible tile layer URL template
   * For use in frontend map libraries
   */
  getTileLayerTemplate(
    style: 'standard' | 'humanitarian' | 'topo' = 'standard',
  ): string {
    const templates = {
      standard: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      humanitarian: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
      topo: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    };
    return templates[style];
  }

  /**
   * Get map attribution for OpenStreetMap
   */
  getMapAttribution(): string {
    return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  }

  /**
   * Get default map view for Lebanon
   */
  getDefaultLebanonView() {
    return LEBANON_DEFAULT_CENTER;
  }

  /**
   * Calculate bounding box for a center point and radius
   * Useful for "nearby stores" queries
   */
  calculateBoundingBox(
    latitude: number,
    longitude: number,
    radiusKm: number,
  ): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
    // Approximate: 1 degree latitude ≈ 111 km
    // 1 degree longitude ≈ 111 km * cos(latitude)
    const latDelta = radiusKm / 111;
    const lonDelta = radiusKm / (111 * Math.cos((latitude * Math.PI) / 180));

    return {
      minLat: latitude - latDelta,
      maxLat: latitude + latDelta,
      minLon: longitude - lonDelta,
      maxLon: longitude + lonDelta,
    };
  }

  /**
   * Calculate distance between two coordinates in kilometers (Haversine formula)
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  private toRad(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}
