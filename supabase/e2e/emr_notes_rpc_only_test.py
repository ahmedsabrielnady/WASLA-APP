# wasla-test only (drafts 2700 + 2800). Synthetic. Precondition (test-data fixture, restored afterwards): provider 46bfa0b7... is temporarily kind doctor with schedules (user 3).
import os,datetime
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0];exec(src)
T={n:login(str(n)) for n in (2,3,5,9)}
def chk(n,ok,x=""):print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
uid=lambda t:call("/auth/v1/user",None,t)[1]["id"]
P9=uid(T[9]);D2="46bfa0b7-2501-4676-a724-e052603b7935"
LOG=lambda:len(call("/rest/v1/emr_access_log?select=id&patient_id=eq."+P9,None,T[9])[1])
chk("precondition: provider is a doctor now",call("/rest/v1/providers?select=kind&id=eq."+D2,None,T[2])[1]==[{"kind":"doctor"}])
# doctor 1 regression
d1n=call("/rest/v1/medical_notes?select=id&patient_id=eq."+P9,None,T[5]);chk("doctor 1 direct select on medical_notes returns nothing now",d1n[0]==200 and d1n[1]==[],d1n[1])
b=LOG();f1=rpc("doctor_open_patient_file",{"p_patient":P9},T[5]);chk("doctor 1 still gets notes through the audited RPC, with one audit row",f1[0]==200 and len(f1[1]["notes"])>=1 and LOG()==b+1,(len(f1[1]["notes"]) if f1[0]==200 else f1))
chk("patient 9 still reads their own notes directly",len(call("/rest/v1/medical_notes?select=id&patient_id=eq."+P9,None,T[9])[1])>=1)
o=call("/rest/v1/orders?select=id&customer_id=eq."+P9+"&sector=in.(clinic,nursing)&limit=3",None,T[5]);b=LOG()
chk("doctor 1 still lists appointment orders directly (operations unchanged) and that read is NOT audited",o[0]==200 and len(o[1])==3 and LOG()==b,(len(o[1]),LOG()-b))
# doctor 2 positive control
day=(datetime.datetime.utcnow()+datetime.timedelta(days=4)).strftime("%Y-%m-%d")
st,slots=rpc("clinic_available_slots",{"p_provider":D2,"p_day":day},T[9]);chk("doctor 2 has slots",st==200 and isinstance(slots,list) and len(slots)>0,(st,str(slots)[:60]))
r=rpc("book_clinic_slot",{"p_provider":D2,"p_at":slots[0]["slot"],"p_notes":"اختبار"},T[9]) if st==200 and slots else (0,None);chk("patient 9 books doctor 2",r[0]==200,(r[0],msg(r)))
oid2=r[1][0]["out_order_id"] if r[0]==200 else None
r=rpc("doctor_add_note",{"p_order":oid2,"p_note":"ملاحظة الدكتور الثاني التركيبية"},T[3]);chk("doctor 2 adds a note on their own order",r[0]==200,(r[0],msg(r)))
f2=rpc("doctor_open_patient_file",{"p_patient":P9},T[3])
chk("doctor 2 file holds this run's note once and only doctor 2's notes (positive control)",f2[0]==200 and len([n for n in f2[1]["notes"] if n["order_id"]==oid2])==1 and all("الثاني" in n["note"] for n in f2[1]["notes"]),(f2[0],len(f2[1]["notes"]) if f2[0]==200 else f2))
mine2={x["id"] for x in call("/rest/v1/orders?select=id&provider_id=eq."+D2+"&sector=in.(clinic,nursing)&customer_id=eq."+P9,None,T[9])[1]}
chk("doctor 2 file holds exactly the orders placed with doctor 2 (includes the new one)",f2[0]==200 and {x["id"] for x in f2[1]["orders"]}==mine2 and oid2 in mine2,(len(mine2),))
f1b=rpc("doctor_open_patient_file",{"p_patient":P9},T[5])
chk("doctor 1 file excludes doctor 2's note and order (cross-doctor isolation)",f1b[0]==200 and all("الثاني" not in n["note"] for n in f1b[1]["notes"]) and oid2 not in [x["id"] for x in f1b[1]["orders"]])
chk("doctor 2 direct note select returns nothing",call("/rest/v1/medical_notes?select=id&patient_id=eq."+P9,None,T[3])[1]==[])
r=rpc("doctor_add_note",{"p_order":oid2,"p_note":"محاولة من الدكتور الأول"},T[5]);chk("doctor 1 cannot add a note to doctor 2's order",r[0]>=400,(r[0],msg(r)))
