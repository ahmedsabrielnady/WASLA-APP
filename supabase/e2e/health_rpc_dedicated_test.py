# VARIANT of health_rpc_test.py run against dedicated fixtures: user 11 pharmacy (صيدلية الشفاء), user 12 lab. Audience always [pharmacy 11].
# wasla-test only, synthetic data. Users: 1 customer, 2 staff, 3 technician, 5 doctor, 6 teacher, 7 pharmacy (merchant/pharmacy), 8 radiology (merchant/radiology).
# Rate-limit style refusals (HTTP 500 / 53400) are never counted as a pass for access checks: `deny` requires a 4xx with a role/validation message.
import os
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
TK={n:login(str(n)) for n in (1,2,3,5,6,7,8,9,11,12)}
# Requester is user 9: user 1 keeps open/answered prescription rows from other suites and the 3-open cap (answered counts as open) would collide.
for _k in ('terms','privacy'):rpc('accept_consent',{'p_kind':_k,'p_version':'draft-2026-11-24.2'},TK[9])
R=[]
for _k in ('terms','privacy'):rpc('accept_consent',{'p_kind':_k,'p_version':'draft-2026-11-24.2'},TK[11])
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:150])
def msg(b):return b.get("message","") if isinstance(b,dict) else str(b)
def deny(n,st,b,why=None):
    ok=400<=st<500 and "53400" not in str(b) and (why is None or why in msg(b));chk(n,ok,(st,msg(b)[:70]))
def get(path,who):return call("/rest/v1/"+path,None,TK[who])[1]
T="أشعة سينية صدر (تجريبي)"
st,tid=rpc("provider_upsert_lab_test",{"p_name":T,"p_kind":"lab","p_price":150},TK[12]);chk("dedicated lab provider adds a priced test",st==200,tid)
deny("lab provider cannot add a 'radiology' test",*rpc("provider_upsert_lab_test",{"p_name":"أشعة (تجريبي)","p_kind":"radiology","p_price":60},TK[12]),"معتمد")
for n,l in ((7,"pharmacy"),(5,"doctor"),(6,"teacher"),(3,"technician"),(1,"customer")):
    for k in ("lab","radiology"):
        deny(f"{l} cannot add a {k} test",*rpc("provider_upsert_lab_test",{"p_name":"تحليل تجريبي ممنوع","p_kind":k,"p_price":50},TK[n]),"معتمد")
for pr in (0,20001):deny(f"price {pr} refused",*rpc("provider_upsert_lab_test",{"p_name":T,"p_kind":"lab","p_price":pr},TK[12]))
st,t2=rpc("provider_upsert_lab_test",{"p_name":T,"p_kind":"lab","p_price":180},TK[12]);chk("re-adding same name updates the price (same id)",st==200 and t2==tid,t2)
rows=get("lab_tests?select=id,kind,name,price_egp&id=eq."+str(tid),1);chk("customer sees the test priced 180",len(rows)==1 and rows[0]["price_egp"]==180,rows)
deny("pharmacy cannot deactivate another provider's test",*rpc("provider_set_lab_test_active",{"p_test":tid,"p_active":False},TK[11]))
c,_=call("/rest/v1/lab_tests?id=eq."+str(tid),{"price_egp":1},TK[11],method="PATCH");chk("pharmacy direct PATCH of the price changes nothing",get("lab_tests?select=price_egp&id=eq."+str(tid),2)[0]["price_egp"]==180,c)
chk("owner deactivates",rpc("provider_set_lab_test_active",{"p_test":tid,"p_active":False},TK[12])[0] in (200,204))
chk("customer no longer sees inactive test",get("lab_tests?select=id&id=eq."+str(tid),1)==[])
chk("owner still sees it",len(get("lab_tests?select=id&id=eq."+str(tid),12))==1)
rpc("provider_set_lab_test_active",{"p_test":tid,"p_active":True},TK[12])
chk("customer sees it again",len(get("lab_tests?select=id&id=eq."+str(tid),1))==1)
# prescriptions
N="أموكسيسيلين 500 + باراسيتامول (بيانات تجريبية)"
ids=[]
for i in range(3):
    st,b=rpc("submit_prescription_request",{"p_note":N+str(i)},TK[9]);chk(f"customer submits request {i+1}",st==200,b);ids.append(b if st==200 else None)
st,b=rpc("submit_prescription_request",{"p_note":N+"x"},TK[9]);chk("4th open request refused with the open-requests message (not a generic rate limit)",st>=400 and "3 طلبات" in msg(b),(st,msg(b)[:60]))
deny("short note refused",*rpc("submit_prescription_request",{"p_note":"ab"},TK[9]))
chk("anonymous cannot submit",call("/rest/v1/rpc/submit_prescription_request",{"p_note":N},None)[0]>=400)
r0=ids[0]
st,ph=rpc("list_pharmacies",{},TK[9]);PH=[x["id"] for x in ph] if st==200 else [];P11=[x["id"] for x in ph if "الشفاء" in str(x.get("display_name"))][0]
chk("customer lists approved pharmacies",st==200 and len(PH)>=1,len(PH))
chk("no pharmacy sees a request before the patient picks an audience",get("prescription_requests?select=id&id=eq."+r0,11)==[])
st,b=rpc("rx_set_audience",{"p_request":r0,"p_pharmacies":[P11],"p_consent":True},TK[9]);chk("patient selects pharmacy with consent",st in(200,204),(st,b))
chk("customer reads own request",len(get("prescription_requests?select=id,note,status&id=eq."+r0,9))==1)
st,b=call("/rest/v1/prescription_requests?select=customer_id&id=eq."+r0,None,TK[9]);chk("requester id is not readable by anyone, not even the owner",st>=400,(st,msg(b)[:60]))
st,b=call("/rest/v1/prescription_requests?select=customer_id&id=eq."+r0,None,TK[11]);chk("pharmacy cannot read requester id",st>=400,(st,msg(b)[:60]))
chk("pharmacy sees open requests",len(get("prescription_requests?select=id&id=eq."+r0,11))==1)
for n,l in ((8,"radiology"),(5,"doctor"),(6,"teacher"),(3,"technician")):
    chk(f"{l} sees no one's prescription request",get("prescription_requests?select=id&id=eq."+r0,n)==[])
    deny(f"{l} cannot quote",*rpc("pharmacy_quote_request",{"p_request":r0,"p_price":50},TK[n]),"صيدلية")
deny("customer cannot quote",*rpc("pharmacy_quote_request",{"p_request":r0,"p_price":50},TK[9]),"صيدلية")
deny("price 0 refused",*rpc("pharmacy_quote_request",{"p_request":r0,"p_price":0},TK[11]))
st,q=rpc("pharmacy_quote_request",{"p_request":r0,"p_price":85,"p_note":"متوفر الآن (تجريبي)"},TK[11]);chk("pharmacy quotes 85",st==200,q)
st,q2=rpc("pharmacy_quote_request",{"p_request":r0,"p_price":90},TK[11]);chk("same pharmacy re-quote updates (same id)",st==200 and q2==q,q2)
chk("request is now answered",get("prescription_requests?select=status&id=eq."+r0,9)[0]["status"]=="answered")
qs=get("prescription_quotes?select=id,price_egp&request_id=eq."+r0,9);chk("customer reads the quote (90)",len(qs)==1 and qs[0]["price_egp"]==90,qs)
chk("radiology provider cannot read the quote",get("prescription_quotes?select=id&request_id=eq."+r0,12)==[])
chk("doctor cannot read the quote",get("prescription_quotes?select=id&request_id=eq."+r0,5)==[])
chk("quoting pharmacy and staff can read it",len(get("prescription_quotes?select=id&request_id=eq."+r0,11))==1 and len(get("prescription_quotes?select=id&request_id=eq."+r0,2))==1)
st,own=rpc("submit_prescription_request",{"p_note":"طلب صيدلية لنفسها (تجريبي)"},TK[11]);chk("pharmacy account may also be a customer (purchasing is role-neutral)",st==200,own)
rpc("rx_set_audience",{"p_request":own,"p_pharmacies":[P11],"p_consent":True},TK[11])
deny("pharmacy cannot quote its own request",*rpc("pharmacy_quote_request",{"p_request":own,"p_price":50},TK[11]),"طلبك")
deny("doctor cannot close the customer's request",*rpc("customer_close_prescription_request",{"p_request":r0},TK[5]))
for r in ids+[own]:
    who=9 if r!=own else 11
    chk("owner closes request",rpc("customer_close_prescription_request",{"p_request":r},TK[who])[0] in (200,204))
deny("quote on a closed request refused",*rpc("pharmacy_quote_request",{"p_request":r0,"p_price":50},TK[11]),"مش متاح")
print("DONE",sum(R),"pass",len(R)-sum(R),"fail")
