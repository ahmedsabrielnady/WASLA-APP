# wasla-test only. Medical notes (draft 0900): doctor adds via checked RPC, patient reads only own. Synthetic text only.
import os,datetime
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
import json
exec(src)
TK={n:login(str(n)) for n in (1,2,3,5,6,7,8)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:150])
def get(path,who):return call("/rest/v1/"+path,None,TK[who])
prov={r["user_id"]:r for r in get("providers?select=id,user_id,kind",2)[1]}
uid=lambda n:call("/auth/v1/user",None,TK[n])[1]["id"]
doc=prov[uid(5)]["id"]
day=(datetime.datetime.utcnow()+datetime.timedelta(days=5)).strftime("%Y-%m-%d")
sl=rpc("clinic_available_slots",{"p_provider":doc,"p_day":day},TK[1])[1]
st,b=rpc("book_clinic_slot",{"p_provider":doc,"p_at":sl[0]["slot"],"p_notes":"اختبار ملاحظات"},TK[1]);chk("customer books a clinic order",st==200,b);oid=b[0]["out_order_id"]
st,nid=rpc("doctor_add_note",{"p_order":oid,"p_note":"ملاحظة تجريبية (بيانات تجريبية)"},TK[5]);chk("assigned doctor adds a note",st==200 and isinstance(nid,int),(st,nid))
for n,l in ((1,"customer"),(2,"staff"),(3,"technician"),(6,"teacher"),(7,"merchant"),(8,"merchant2")):
    st,b=rpc("doctor_add_note",{"p_order":oid,"p_note":"ملاحظة غير مسموحة"},TK[n]);chk(f"{l} cannot add a note",st>=400 and "53400" not in str(b),(st,str(b)[:50]))
st,b=call("/rest/v1/rpc/doctor_add_note",{"p_order":oid,"p_note":"anon note xx"});chk("anon cannot add",st>=400 and "53400" not in str(b),st)
for bad in ("","ab","x"*2001):
    st,b=rpc("doctor_add_note",{"p_order":oid,"p_note":bad},TK[5]);chk(f"bad length {len(bad)} refused",st>=400 and "53400" not in str(b),(st,str(b)[:40]))
st,b=rpc("doctor_add_note",{"p_order":"00000000-0000-4000-8000-000000000000","p_note":"order غير موجود"},TK[5]);chk("unknown order refused",st>=400 and "53400" not in str(b),(st,str(b)[:40]))
# a non-clinic order of the same customer cannot get a note
st,r=rpc("place_order_v2",{"p_sector":"maintenance","p_item_id":4,"p_address":"شارع الجمهورية (test)","p_notes":"x","p_source":"web","p_idempotency_key":"11111111-2222-4333-8444-"+os.urandom(6).hex(),"p_lat":None,"p_lng":None},TK[1])
if st==200:
    st,b=rpc("doctor_add_note",{"p_order":r[0]["out_order_id"],"p_note":"ليس عيادة ولا تمريض"},TK[5]);chk("doctor cannot note a non-clinic order",st>=400 and "53400" not in str(b),(st,str(b)[:40]))
else:print("skip non-clinic",st,str(r)[:80])
st,b=get("medical_notes?select=id,note,patient_id",1);chk("patient reads own note",st==200 and any(x["id"]==nid for x in b),(st,len(b)))
chk("patient cannot write directly",call("/rest/v1/medical_notes",{"doctor_id":doc,"patient_id":uid(1),"note":"direct"},TK[1])[0]>=400)
st,b=call("/rest/v1/medical_notes?id=eq.%s"%nid,{"note":"edited"},TK[1],method="PATCH");chk("patient cannot edit",st>=400 or b in ([],None),(st,str(b)[:40]))
st,b=get("medical_notes?select=note&id=eq.%s"%nid,1);chk("note unchanged after patient edit attempt",b and "edited" not in b[0]["note"],b)
for n in (3,6,7,8):
    st,b=get("medical_notes?select=id",n);chk(f"user{n} sees no notes",st==200 and b==[],(st,str(b)[:40]))
# since draft 2800 the doctor has no direct read: direct table read must be empty, and the audited RPC must return the note (positive control)
st,b=get("medical_notes?select=id",5);chk("doctor has no direct table read (draft 2800, RPC only)",st==200 and b==[],(st,len(b)))
st,fl=rpc("doctor_open_patient_file",{"p_patient":uid(1)},TK[5]);chk("doctor sees own note through the audited RPC",st==200 and "ملاحظة تجريبية (بيانات تجريبية)" in json.dumps(fl,ensure_ascii=False),(st,str(fl)[:60]))
a=call("/rest/v1/medical_notes?select=id");chk("anon sees none",a[0]>=400 or a[1]==[],a[0])
print("DONE",sum(R),"pass",len(R)-sum(R),"fail",flush=True)
