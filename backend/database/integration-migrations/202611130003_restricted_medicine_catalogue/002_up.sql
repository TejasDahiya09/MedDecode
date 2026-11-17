\set ON_ERROR_STOP on
-- Proposal only: operator must review column classifications and ownership.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE FUNCTION public.meddecode_catalogue_search_v1(p_query text, p_limit integer, p_offset integer)
RETURNS TABLE (id uuid, canonical_name text, generic_name text, brand_name text,
  dosage_form text, strength_value numeric, strength_unit text, manufacturer_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  IF p_query IS NULL OR length(btrim(p_query)) NOT BETWEEN 2 AND 80
     OR p_query !~ '^[[:alnum:] .+\-]+$' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 51
     OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 500 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid catalogue query';
  END IF;
  RETURN QUERY SELECT m.id,m.canonical_name,m.generic_name,m.brand_name,m.dosage_form,
    m.strength_value,m.strength_unit,mf.name
  FROM public.medicines m LEFT JOIN public.manufacturers mf ON mf.id=m.manufacturer_id
  WHERE m.normalized_name ILIKE '%' || btrim(p_query) || '%'
     OR EXISTS (SELECT 1 FROM public.medicine_aliases a WHERE a.medicine_id=m.id
       AND a.normalized_alias ILIKE '%' || btrim(p_query) || '%')
  ORDER BY m.canonical_name, m.id LIMIT p_limit OFFSET p_offset;
END
$function$;
CREATE FUNCTION public.meddecode_catalogue_detail_v1(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication required'; END IF;
  IF p_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid medicine id'; END IF;
  SELECT jsonb_build_object(
    'id',m.id,'canonical_name',m.canonical_name,'generic_name',m.generic_name,
    'brand_name',m.brand_name,'dosage_form',m.dosage_form,
    'strength_value',m.strength_value,'strength_unit',m.strength_unit,'manufacturer_name',mf.name,
    'ingredients',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'name',i.ingredient_name,'strength_value',mi.ingredient_strength_value,
      'strength_unit',mi.ingredient_strength_unit) ORDER BY i.ingredient_name,i.id)
      FROM public.medicine_ingredients mi JOIN public.active_ingredients i ON i.id=mi.ingredient_id
      WHERE mi.medicine_id=m.id),'[]'::jsonb),
    'aliases',COALESCE((SELECT jsonb_agg(a.alias_name ORDER BY a.alias_name)
      FROM public.medicine_aliases a WHERE a.medicine_id=m.id),'[]'::jsonb),
    'sources',COALESCE((SELECT jsonb_agg(DISTINCT s.source_dataset)
      FROM public.medicine_sources s WHERE s.medicine_id=m.id),'[]'::jsonb),
    'prices','[]'::jsonb)
  INTO result FROM public.medicines m LEFT JOIN public.manufacturers mf ON mf.id=m.manufacturer_id
  WHERE m.id=p_id;
  RETURN result;
END
$function$;
ALTER FUNCTION public.meddecode_catalogue_search_v1(text,integer,integer) OWNER TO postgres;
ALTER FUNCTION public.meddecode_catalogue_detail_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.meddecode_catalogue_search_v1(text,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.meddecode_catalogue_detail_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_catalogue_search_v1(text,integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.meddecode_catalogue_detail_v1(uuid) TO authenticated;
COMMIT;
