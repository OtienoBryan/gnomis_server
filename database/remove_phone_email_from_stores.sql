-- Phone and email were dropped from the store management feature; the columns
-- (added in add_location_phone_email_to_stores.sql) are no longer used.
ALTER TABLE stores
  DROP COLUMN phone,
  DROP COLUMN email;
