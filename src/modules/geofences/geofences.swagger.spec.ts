import {
  createGeofenceBodySchema,
  geofenceEventHistorySuccessSchema,
  geofenceListSuccessSchema,
  geofenceSuccessSchema,
  replaceMembersBodySchema,
  updateGeofenceBodySchema,
} from './geofences.swagger';

describe('Phase 5 geofence Swagger contracts', () => {
  it('documents strict create, update, and member replacement bodies', () => {
    expect(createGeofenceBodySchema.additionalProperties).toBe(false);
    expect(updateGeofenceBodySchema.additionalProperties).toBe(false);
    expect(replaceMembersBodySchema.additionalProperties).toBe(false);
  });

  it('documents concrete resource, page, and cursor success envelopes', () => {
    expect(geofenceSuccessSchema.properties).toHaveProperty('data');
    expect(geofenceListSuccessSchema.properties).toHaveProperty('pagination');
    expect(geofenceEventHistorySuccessSchema.properties).toHaveProperty(
      'pagination',
    );
  });

  it('does not document client-controlled creator or transition fields', () => {
    expect(createGeofenceBodySchema.properties).not.toHaveProperty('createdBy');
    expect(createGeofenceBodySchema.properties).not.toHaveProperty('eventType');
    expect(updateGeofenceBodySchema.properties).not.toHaveProperty('familyId');
  });
});
