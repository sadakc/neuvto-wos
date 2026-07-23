DROP POLICY IF EXISTS "Anyone can submit a demo request" ON public.demo_requests;

CREATE POLICY "Anyone can submit a demo request"
ON public.demo_requests
FOR INSERT
TO anon, authenticated
WITH CHECK (
  name IS NOT NULL
  AND char_length(btrim(name)) BETWEEN 1 AND 200
  AND email IS NOT NULL
  AND char_length(email) BETWEEN 3 AND 320
  AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  AND (company IS NULL OR char_length(company) <= 200)
  AND (message IS NULL OR char_length(message) <= 5000)
);