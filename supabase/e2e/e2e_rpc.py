import json,urllib.request,urllib.error,uuid
import os
U=os.environ["WASLA_TEST_URL"];K=os.environ["WASLA_TEST_PUBLISHABLE_KEY"]
import sys as _s;_s.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
import harness_guard as _hg;_hg.check_url(U)  # exact test project URL only
PW=os.environ["WASLA_TEST_PW"]
def call(path,body=None,tok=None,method=None,prefer=None):
    h={"apikey":K,"content-type":"application/json"}
    if tok:h["Authorization"]="Bearer "+tok
    if prefer:h["Prefer"]=prefer
    r=urllib.request.Request(U+path,data=json.dumps(body).encode() if body is not None else None,headers=h,method=method or ("POST" if body is not None else "GET"))
    try:
        with urllib.request.urlopen(r,timeout=30) as x:
            t=x.read().decode();return x.status,(json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t=e.read().decode()
        try:return e.code,json.loads(t)
        except:return e.code,t
def login(n):
    s,d=call("/auth/v1/token?grant_type=password",{"email":f"0100000000{n}@wasla.app","password":PW});return d.get("access_token")
def rpc(f,b,t):return call("/rest/v1/rpc/"+f,b,t)
def msg(r):
    s,d=r;return f"{s} "+(str(d.get('message',d))[:110] if isinstance(d,dict) else str(d)[:110])
res=[]
def rec(name,ok,detail=""):
    res.append((name,ok));print(("PASS " if ok else "FAIL ")+name+" | "+detail)

c,s,p=login("1"),login("2"),login("3")
PID=os.environ["WASLA_TEST_PROVIDER_ID"]
print("consent",rpc("accept_consent",{"p_kind":"terms","p_version":"2026-11"},c)[0],rpc("accept_consent",{"p_kind":"privacy","p_version":"2026-11"},c)[0])
print("approve (staff/admin)",msg(rpc("approve_provider",{"p_provider":PID},s)))
print("coverage item4",msg(rpc("admin_set_provider_service_coverage",{"p_provider_id":PID,"p_service_item_id":4,"p_active":True},s)))
print("coverage item7",msg(rpc("admin_set_provider_service_coverage",{"p_provider_id":PID,"p_service_item_id":7,"p_active":True},s)))
def place(key,item=4,tok=None):
    return rpc("place_order_v2",{"p_sector":"maintenance","p_item_id":item,"p_address":"شارع الجمهورية، شبين القناطر (test)","p_notes":"fake e2e","p_source":"web","p_idempotency_key":key,"p_lat":None,"p_lng":None},tok or c)
k=str(uuid.uuid4())
r=place(k);print("place raw",str(r)[:300])
oid=None
if r[0]==200:
    oid=r[1][0]["out_order_id"]
rec("1 customer places order",bool(oid),str(oid))
r2=place(k)
same=r2[0]==200 and str(r2[1])==str(r[1])
rec("2 idempotent resend returns same order",same,str(r2)[:120])
print("tracking",str(rpc("my_order_tracking",{"p_order":oid},c))[:300])
_,mine=call("/rest/v1/orders?select=id,status,price_egp&order=created_at.desc",None,c);print("customer sees orders",mine)
rec("2b only one order row",isinstance(mine,list) and len(mine)==1,str(len(mine)) if isinstance(mine,list) else str(mine))
_,pv=call("/rest/v1/orders?select=id",None,p);print("provider sees before assign",pv)
rec("5 provider/other cannot see unassigned order",pv==[] ,str(pv)[:80])
# permissions
rec("8b customer cannot assign",rpc("assign_order_v2",{"p_order":oid,"p_provider":PID},c)[0]>=400,msg(rpc("assign_order_v2",{"p_order":oid,"p_provider":PID},c)))
rec("8c customer cannot quote",rpc("quote_order",{"p_order":oid,"p_price":1},c)[0]>=400,msg(rpc("quote_order",{"p_order":oid,"p_price":1},c)))
rec("8d customer cannot staff-set status",rpc("staff_set_order_status_v2",{"p_order":oid,"p_to":"done","p_note":None},c)[0]>=400,msg(rpc("staff_set_order_status_v2",{"p_order":oid,"p_to":"done","p_note":None},c)))
rec("8e customer cannot provider-set status",rpc("provider_set_order_status_v2",{"p_order":oid,"p_to":"done","p_note":None},c)[0]>=400,msg(rpc("provider_set_order_status_v2",{"p_order":oid,"p_to":"done","p_note":None},c)))
anon=call("/rest/v1/rpc/place_order_v2",{"p_sector":"maintenance","p_item_id":4,"p_address":"abcd efgh","p_notes":None,"p_source":"web","p_idempotency_key":str(uuid.uuid4()),"p_lat":None,"p_lng":None})
rec("8f anon cannot place order",anon[0]>=400,str(anon)[:100])
a=call("/rest/v1/orders?select=id",None,None);print("anon read orders",a)
rec("8g anon reads no orders",a[0]>=400 or a[1]==[],str(a)[:80])
# staff flow
print("staff sees",str(call("/rest/v1/orders?select=id,status",None,s))[:200])
print("assign (new)",msg(rpc("assign_order_v2",{"p_order":oid,"p_provider":PID},s)))
print("staff confirm",msg(rpc("staff_set_order_status_v2",{"p_order":oid,"p_to":"confirmed","p_note":None},s)))
_,pv=call("/rest/v1/orders?select=id,status",None,p);print("provider sees after assign",pv)
rec("4a provider sees only assigned order",isinstance(pv,list) and len(pv)==1,str(pv))
print("provider in_progress",msg(rpc("provider_set_order_status_v2",{"p_order":oid,"p_to":"in_progress","p_note":None},p)))
print("provider done",msg(rpc("provider_set_order_status_v2",{"p_order":oid,"p_to":"done","p_note":None},p)))
_,mine=call("/rest/v1/orders?select=id,status",None,c);print("customer final",mine)
rec("5 customer sees status done",isinstance(mine,list) and mine and mine[0]["status"]=="done",str(mine))
# cancel paths
o2=place(str(uuid.uuid4()));id2=o2[1][0]["out_order_id"]
print("order2",str(o2)[:120])
print("cancel before confirm",msg(rpc("customer_cancel_order_v2",{"p_order":id2,"p_reason":"test"},c)))
o3=place(str(uuid.uuid4()));id3=o3[1][0]["out_order_id"]
print("assign3",msg(rpc("assign_order_v2",{"p_order":id3,"p_provider":PID},s)));print("confirm3",msg(rpc("staff_set_order_status_v2",{"p_order":id3,"p_to":"confirmed","p_note":None},s)))
print("cancel after confirm",msg(rpc("customer_cancel_order_v2",{"p_order":id3,"p_reason":"test"},c)))
# electrician no price
o4=place(str(uuid.uuid4()),7);print("electrician order",str(o4)[:120]);id4=o4[1][0]["out_order_id"]
print("quote 120",msg(rpc("quote_order",{"p_order":id4,"p_price":120},s)))
_,m=call("/rest/v1/orders?select=ref,status,price_egp&order=created_at.asc",None,c);print("final orders",m)
print("summary",sum(1 for _,o in res if o),"pass",sum(1 for _,o in res if not o),"fail")
