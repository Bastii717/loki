UPDATE "reports" SET "category" = CASE "category"
  WHEN 'verletzend' THEN 'hurtful'
  WHEN 'verstoerend' THEN 'disturbing'
  WHEN 'falschinfo' THEN 'misinformation'
  WHEN 'sonstiges' THEN 'other'
  ELSE "category" END;
