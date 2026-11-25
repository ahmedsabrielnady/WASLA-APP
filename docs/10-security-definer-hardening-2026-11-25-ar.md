# توثيق تقوية مسارات البحث وصلاحيات الملفات الشخصية — 25 نوفمبر 2026

## 1) تثبيت search_path لدوال SECURITY DEFINER

طُبقت migration باسم `harden_security_definer_search_paths` على مشروع Supabase الصحيح `yfgvimcqbtthnrbzbhft`.

تم تثبيت `search_path = ''` لتسع دوال `SECURITY DEFINER`:

- `accept_consent(text, text)`
- `admin_reset_user_password(text, text)`
- `approve_provider(uuid)`
- `current_provider_id()`
- `current_role_name()`
- `is_staff()`
- `my_order_suggestions()`
- `my_order_tracking(uuid)`
- `set_order_location(uuid, double precision, double precision, text)`

## 2) إصلاح تكرار RLS في profiles

أثناء اختبار تحديث الملف الشخصي تحت دور `authenticated`، ظهر الخطأ:

`42P17: infinite recursion detected in policy for relation "profiles"`

كان شرط `WITH CHECK` في سياسة `profiles_update_own` يستعلم من جدول `profiles` نفسه مباشرة لمقارنة الدور القديم، ما تسبب في إعادة دخول السياسة على نفسها.

تم تطبيق migration باسم `fix_profiles_update_policy_recursion`:
- إنشاء دالة مساعدة `private.current_profile_role()` في مخطط غير `public`.
- الدالة `STABLE SECURITY DEFINER` مع `search_path = ''` وتقرأ دور المستخدم الحالي فقط باستخدام `auth.uid()`.
- سحب التنفيذ من `PUBLIC` و`anon` و`authenticated` ثم منحه صراحة إلى `authenticated` فقط، مع منح `USAGE` على مخطط `private` لهذا الدور.
- إعادة بناء سياسة `profiles_update_own` بحيث تسمح بتحديث صف المستخدم نفسه، لكنها تشترط بقاء الدور مساويًا للدور الحالي المسترجع عبر الدالة المساعدة.

### اختبارات مباشرة على قاعدة الإنتاج

تم تنفيذ الاختبارات داخل معاملات تنتهي بـ `ROLLBACK`، باستخدام حساب اختبار موجود بدور `customer`، دون حفظ أي تعديل على البيانات:

- تحديث الملف الشخصي الذاتي مع الإبقاء على الدور: نجح وأعاد صف المستخدم.
- محاولة تغيير الدور إلى `admin`: رُفضت بواسطة RLS بالخطأ `42501`.
- اختبار التحديث السابق كان يفشل بسبب recursion قبل إصلاح السياسة؛ بعد الإصلاح اختفى هذا العطل في مسار التحديث الذاتي.

## 3) مراجعة دوال SECURITY DEFINER

- لا توجد دوال من الدوال العامة التي راجعناها قابلة للتنفيذ من `anon`.
- لا تزال 22 ملاحظة Advisor عن دوال `SECURITY DEFINER` المتاحة للمستخدم المسجل. هذه الملاحظات تتطلب مراجعة صلاحيات كل RPC حسب وظيفته، ولا يصح إخفاؤها بسحب جماعي قد يعطل التطبيق.
- ما زالت حماية كلمات المرور المسرّبة غير مفعلة في Supabase Auth.
- جدول `public.order_status_transitions` عليه RLS بلا سياسات مباشرة؛ لم نضف سياسة عامة لأن الوصول إليه يتم عبر دوال تشغيلية محددة.

### متابعة التدقيق — بعد فحص RPC

- أعيد تشغيل Supabase Security Advisor بتاريخ 25 نوفمبر 2026؛ النتائج ما زالت: 22 تحذيرًا لدوال `SECURITY DEFINER` القابلة للاستدعاء من `authenticated`، وملاحظة RLS معلوماتية واحدة على `public.order_status_transitions`، وتحذير حماية كلمات المرور المسرّبة.
- فُحصت أجسام الدوال القابلة للاستدعاء. الدوال التي لا تحتوي مباشرة على `auth.uid()` هي `approve_provider` و`is_staff` (تعتمدان على دالة تحقق الدور)، و`clinic_available_slots` (تعرض مواعيد متاحة فقط لطبيب معتمد ونشط وغير تجريبي). لا يُعد غياب النص `auth.uid()` وحده ثغرة إذا كان التفويض مفوضًا بأمان لدالة أخرى أو كانت الدالة للبيانات العامة.
- اختبارات رفض صلاحيات داخل معاملة تنتهي بـ `ROLLBACK` باستخدام حساب `customer`: رُفضت محاولات استدعاء `admin_update_service_item_price` و`approve_provider` و`create_invite('staff')` و`quote_order` بصلاحية غير كافية. لم تُحفظ أي تغييرات.
- ظهرت نقطة تحقق إضافية في `place_order_v2`: الدالة كانت لا تتحقق من حدود إحداثيات `latitude/longitude` ولا من تقديمهما معًا. تم إصلاح ذلك مباشرة على قاعدة الإنتاج، مع الحفاظ على إمكانية ترك الموقع فارغًا بإرسال القيمتين `NULL`.
- `clinic_available_slots` متاحة عمدًا للمستخدمين المسجلين لعرض المواعيد، وتتحقق من أن الطبيب معتمد ونشط وغير تجريبي. لا ينبغي سحب صلاحيتها آليًا قبل مراجعة اعتماد الواجهة عليها.

## 4) ملفات الأرشفة والاختبارات

- `supabase/live-patches/20261125_harden_security_definer_search_paths.sql`
- `tests/security-definer-search-path.test.mjs`
- `supabase/live-patches/20261125_validate_order_coordinates.sql`
- `tests/order-coordinate-validation.test.mjs`
- `supabase/live-patches/20261125_fix_profiles_update_policy_recursion.sql`
- `tests/profiles-update-policy.test.mjs`

لم تتغير بيانات العملاء أو الطلبات أو مقدمي الخدمة. التغييرات الحية اقتصرت على تعريف الدالة وسياسة RLS ومخطط المساعدة. تدقيق المتابعة لم يغير بيانات أو صلاحيات، باستثناء استبدال تعريف `place_order_v2` لإضافة التحقق من الإحداثيات. لم يتم إنشاء أو تعديل أو حذف أي طلب.

### تنفيذ واختبار إصلاح الإحداثيات

تم استبدال تعريف `public.place_order_v2` على قاعدة الإنتاج بتاريخ 25 نوفمبر 2026. الإصلاح يرفض إرسال خط العرض دون خط الطول أو العكس، ويرفض خط العرض خارج `[-90, 90]` وخط الطول خارج `[-180, 180]`. الموقع يظل اختياريًا إذا كانت القيمتان `NULL`.

اختبارات مباشرة داخل معاملة `ROLLBACK` باستخدام هوية عميل اختبار:
- خط عرض دون خط طول: رُفض بالرسالة المخصصة.
- خط عرض 91: رُفض.
- خط طول 181: رُفض.
- إرسال القيمتين `NULL`: تجاوز تحقق الإحداثيات ووصل إلى تحقق الخدمة/الموافقة، ما يؤكد الحفاظ على السلوك الاختياري.
- تحقق قراءة تعريف الدالة بعد التعديل من وجود شرطي الزوج والحدود، مع بقاء `search_path` فارغًا.

لم تُنشأ طلبات اختبار ولم تُحفظ تغييرات بيانات.

## 5) حالة النشر

هذا التوثيق لا يعني أن الإنتاج على Vercel يتضمن تغييرات قاعدة البيانات أو المستودع الأخيرة. آخر Production deployment مؤكد قبل هذه المراجعة كان على commit `9f52467acbe234445196ff6d7753149be35bd58b`. PR #40 ما زال مفتوحًا ولم يُدمج؛ تجنبنا الدمج ومحاولات النشر المتكررة بسبب قيود Vercel السابقة.
