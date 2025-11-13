-- Grant RPC execution permissions for brand settings helpers
grant execute on function public.get_brand_limits() to anon, authenticated;
grant execute on function public.set_brand_max_active(text, int) to authenticated;
