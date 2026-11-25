# wasla-test only. Direct table writes to medical_notes by a doctor (bypassing the RPC). Usage: python3 x.py [phase]; phase "inactive" runs while the doctor is deactivated.
import os,sys,datetime
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
phase=sys.argv[1] if len(sys.argv)>1 else "active"
TK={n:login(str(n)) for n in (1,2,5)}
R=[]
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:150])
def get(path,who):return call("/rest/v1/"+path,None,TK[who])
uid=lambda n:call("/auth/v1/user",None,TK[n])[1]["id"]
prov={r["user_id"]:r for r in get("providers?select=id,user_id,kind",2)[1]}
doc=prov[uid(5)]["id"]
# orders visible to doctor (own clinic orders), plus an order of customer 1 that belongs to nobody (maintenance)
_,mine=get("orders?select=id,customer_id,sector,provider_id",5)
own=[o for o in mine if o["sector"] in("clinic","nursing") and o["provider_id"]==doc]
if phase=="inactive":
    _,so=get("orders?select=id,customer_id,sector,provider_id",2);own=[o for o in so if o["sector"] in("clinic","nursing") and o["provider_id"]==doc and o["customer_id"]==uid(1)]
print("doctor orders",len(own))
def ins(patient,order,note="اختبار مباشر (synthetic)",who=5):
    b={"id":int.from_bytes(os.urandom(4),"big")+10**6,"doctor_id":doc,"patient_id":patient,"note":note}
    if order:b["order_id"]=order
    return call("/rest/v1/medical_notes",b,TK[who],prefer="return=minimal")
def rejected(r):return r[0]>=400 and "53400" not in str(r[1])
c1=uid(1);c2=uid(2)
if phase=="inactive":
    r=ins(c1,own[0]["id"] if own else None);chk("inactive doctor direct insert refused",rejected(r),r)
    r=rpc("doctor_add_note",{"p_order":own[0]["id"],"p_note":"inactive doctor note"},TK[5]);chk("inactive doctor RPC refused",rejected(r),r)
    st,b=get("medical_notes?select=id",5);chk("inactive doctor reads none",st==200 and b==[],(st,str(b)[:40]))
else:
    r=ins(c2,None);chk("direct insert for a patient with no order refused",rejected(r),r)
    r=ins(c2,own[0]["id"]);chk("direct insert for wrong patient + valid order refused",rejected(r),r)
    # note for own patient but pointing at someone else's order
    _,allo=get("orders?select=id,customer_id",2)
    other=[o for o in allo if o["customer_id"]!=c1]
    r=ins(c1,other[0]["id"]) if other else (0,"no other order")
    chk("direct insert linking a note to another patient's order refused",rejected(r),r)
    r=ins(c1,None);chk("direct insert without order_id refused",rejected(r),r)
    r=ins(c1,own[0]["id"]);chk("control: direct insert for own patient+order is policy-allowed (proves the refusals above are policy, not grants)",r[0] in (200,201,204),r)
    for who in (1,5):
        r=call("/rest/v1/medical_notes?note=neq.zzzz",{"note":"hacked"},TK[who],method="PATCH");
        _,after=get("medical_notes?select=note",1);chk(f"user{who} update changes nothing (checked on the owner's view, which is non-empty)",len(after)>0 and not any("hacked" in x["note"] for x in after),(r[0],len(after)))
        # since draft 2800 the doctor cannot read notes directly, so "rows still visible to the caller" proves nothing for user 5: count what the owner (user 1) can see before and after instead
        _own=lambda:sum(len(get("medical_notes?select=id",u)[1]) for u in (1,))
        _pre=_own()
        r=call("/rest/v1/medical_notes?note=neq.zzzz",None,TK[who],method="DELETE");_,after=get("medical_notes?select=id",who);_post=_own()
        chk(f"user{who} delete removes nothing (owner visible count unchanged, and not vacuous)",_pre>0 and _post==_pre,(r[0],_pre,_post,len(after)))
print("DONE",sum(R),"pass",len(R)-sum(R),"fail",flush=True)
