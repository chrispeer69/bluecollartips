REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_driver_sensitive_updates() FROM authenticated;