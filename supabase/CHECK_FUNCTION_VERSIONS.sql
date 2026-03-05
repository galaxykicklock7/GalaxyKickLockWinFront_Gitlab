-- Check for duplicate function versions
SELECT 
  proname as function_name,
  pronargs as num_arguments,
  pg_get_function_arguments(oid) as arguments,
  pg_get_functiondef(oid) as definition
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric'
ORDER BY pronargs DESC;

-- Check which version is being called
SELECT 
  proname,
  pronargs,
  pg_get_function_identity_arguments(oid) as signature
FROM pg_proc 
WHERE proname = 'record_imprisonment_metric';
