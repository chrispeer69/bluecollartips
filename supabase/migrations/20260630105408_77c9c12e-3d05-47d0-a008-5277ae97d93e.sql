
-- Replace broad self-update with safe-column-only writes for the driver themselves.
DROP POLICY IF EXISTS "Drivers update self" ON public.drivers;

-- Revoke blanket UPDATE from authenticated; admin/service paths use service_role which bypasses this.
REVOKE UPDATE ON public.drivers FROM authenticated;

-- Allow drivers to update only safe profile/payout fields on their own row.
GRANT UPDATE (venmo_handle, cashapp_handle, zelle_handle, paypal_handle, photo_url)
  ON public.drivers TO authenticated;

CREATE POLICY "Drivers update own safe fields"
  ON public.drivers
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
