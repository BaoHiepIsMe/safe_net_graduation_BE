-- A manager lifts a remote lock with an explicit unlock command.
ALTER TABLE "public"."phone_commands"
  DROP CONSTRAINT "phone_commands_type_check";

ALTER TABLE "public"."phone_commands"
  ADD CONSTRAINT "phone_commands_type_check"
    CHECK ("command_type" IN ('lock', 'unlock', 'ring', 'warning'));
