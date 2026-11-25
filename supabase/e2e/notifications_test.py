# In-app notifications (draft 2000): own-rows isolation, trigger coverage, no direct writes. wasla-test only, synthetic.
import os,datetime,random
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T={n:login(str(n)) for n in (1,2,5,9)}
def chk(n,ok,x=""):print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
N=lambda t,extra="":call("/rest/v1/notifications?select=id,user_id,kind,ref_id,read_at,created_at"+extra+"&order=created_at.asc",None,t)
# Self-contained fixture (synthetic, wasla-test only): create one new and one confirmed nursing order for customer 9 here, BEFORE taking baselines, instead of relying on leftover orders.
import uuid as _u
def _mk():
    r=rpc("request_nursing_visit",{"p_item":15,"p_address":"عنوان اختبار إشعارات","p_notes":"synthetic","p_idempotency_key":str(_u.uuid4())},T[9])
    assert r[0]==200,("fixture: nursing request failed",r[0],msg(r))
    return call("/rest/v1/orders?select=id,status&sector=eq.nursing&order=created_at.desc&limit=1",None,T[9])[1][0]
_a=_mk();_b=_mk()
assert _a["status"]=="new" and _b["status"]=="new",("fixture: expected new orders",_a,_b)
_doc=[x for x in call("/rest/v1/providers?select=id,kind&kind=eq.doctor&user_id=not.is.null",None,T[5])[1]][0]
_r=rpc("assign_order_v2",{"p_order":_a["id"],"p_provider":_doc["id"]},T[2]);assert _r[0] in(200,204),("fixture: assign failed",_r[0],msg(_r))
conf=_a["id"];new=_b["id"]
_st=call("/rest/v1/orders?select=id,status&id=in.("+conf+","+new+")",None,T[9])[1]
assert {x["id"]:x["status"] for x in _st}=={conf:"confirmed",new:"new"},("fixture: unexpected statuses",_st)
uid9=call("/rest/v1/profiles?select=id&limit=1",None,T[9])[1]
b9=len(N(T[9])[1]);b1=len(N(T[1])[1]);b5=len(N(T[5])[1]);b2=len(N(T[2])[1])
# 1 schedule -> order_scheduled for the owner only
r=rpc("staff_schedule_order",{"p_order":conf,"p_at":(datetime.datetime.utcnow()+datetime.timedelta(days=25,seconds=random.randint(1,3000))).strftime("%Y-%m-%dT%H:%M:%SZ")},T[2]);chk("staff schedules an order",r[0] in(200,204),msg(r))
n9=N(T[9])[1];chk("owner got exactly one new notification",len(n9)==b9+1,(b9,len(n9)))
chk("kind order_scheduled, ref is that order, unread",n9[-1]["kind"]=="order_scheduled" and n9[-1]["ref_id"]==conf and n9[-1]["read_at"] is None,n9[-1])
# 2 status change -> order_status
r=rpc("staff_set_order_status_v2",{"p_order":new,"p_to":"cancelled","p_note":"synthetic"},T[2]);chk("staff cancels a new order",r[0] in(200,204),msg(r))
n9b=N(T[9])[1];chk("owner got one more (order_status)",len(n9b)==len(n9)+1 and n9b[-1]["kind"]=="order_status" and n9b[-1]["ref_id"]==new,n9b[-1])
# 3 change request resolved -> declined notification
for x in call("/rest/v1/order_change_requests?select=id&status=eq.open&order_id=eq."+conf,None,T[2])[1]:rpc("staff_resolve_order_change",{"p_request":x["id"],"p_status":"declined"},T[2])
n9c=N(T[9])[1]
r=rpc("customer_request_order_change",{"p_order":conf,"p_kind":"cancel"},T[9]);chk("owner requests cancel",r[0]==200,msg(r));rid=r[1]
n9d=N(T[9])[1];chk("requesting creates no notification for the customer",len(n9d)==len(n9c),(len(n9c),len(n9d)))
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"declined"},T[2]);chk("staff declines",r[0] in(200,204),msg(r))
n9e=N(T[9])[1];chk("owner notified: change_request_declined",len(n9e)==len(n9d)+1 and n9e[-1]["kind"]=="change_request_declined" and n9e[-1]["ref_id"]==conf,n9e[-1])
# isolation
chk("other customer (1) saw no new rows",len(N(T[1])[1])==b1)
chk("doctor (5) saw no new rows",len(N(T[5])[1])==b5)
chk("staff (2) sees none of the customer's rows (own rows only)",all(x["user_id"]!=n9e[-1]["user_id"] for x in N(T[2])[1]) and len(N(T[2])[1])==b2,len(N(T[2])[1]))
chk("customer 1 cannot read customer 9 rows by id filter",N(T[1],"&id=eq."+n9e[-1]["id"])[1]==[])
r=call("/rest/v1/notifications?select=id",None,None);chk("anon refused (401/403)",r[0] in(401,403),r[0])
# payload contains no free text columns
chk("row has only generic columns",sorted(n9e[-1].keys())==sorted(["id","user_id","kind","ref_id","read_at","created_at"]))
# no direct writes
r=call("/rest/v1/notifications",{"user_id":n9e[-1]["user_id"],"kind":"order_status"},T[9],"POST");chk("direct INSERT by owner refused",r[0] in(401,403),r[0])
r=call("/rest/v1/notifications?id=eq."+n9e[-1]["id"],{"read_at":"2020-01-01T00:00:00Z"},T[9],"PATCH");chk("direct UPDATE by owner refused",r[0] in(401,403),r[0])
r=call("/rest/v1/notifications?id=eq."+n9e[-1]["id"],None,T[9],"DELETE");chk("direct DELETE by owner refused",r[0] in(401,403),r[0])
r=call("/rest/v1/notifications",{"user_id":n9e[-1]["user_id"],"kind":"order_status"},T[2],"POST");chk("direct INSERT by staff refused",r[0] in(401,403),r[0])
chk("rows intact after write attempts",len(N(T[9])[1])==len(n9e))
# mark read: own only
rpc("mark_notifications_read",{},T[1])  # clear customer 1 leftovers from the sector checks
r=rpc("mark_notifications_read",{},T[1]);chk("customer 1 marks own read (0 rows)",r[0]==200 and str(r[1])=="0",msg(r))
chk("customer 9 rows still unread after customer 1 call",N(T[9],"&read_at=is.null")[1]!=[])
r=rpc("mark_notifications_read",{},None);chk("anon cannot call mark_notifications_read",r[0] in(401,403),r[0])
r=rpc("mark_notifications_read",{},T[9]);chk("owner marks read",r[0]==200 and int(r[1])>=1,msg(r))
chk("owner has none unread",N(T[9],"&read_at=is.null")[1]==[])
r=rpc("notify_order_change",{},T[9]);chk("trigger function not callable by users (4xx)",r[0] in(401,403,404),r[0])

# --- other sectors: FRESH synthetic order per sector each run, so every run exercises the same sectors ---
import uuid
def fresh_orders():
    out={}
    addr="عنوان اختبار إشعارات"
    # maintenance and car through place_order_v2 (customer 1); store, food through place_product_order and clinic through book_clinic_slot (customer 9)
    for sector,item in (("maintenance",4),("car",8)):
        r=rpc("place_order_v2",{"p_sector":sector,"p_item_id":item,"p_address":addr,"p_notes":None,"p_source":"web","p_idempotency_key":str(uuid.uuid4()),"p_lat":None,"p_lng":None},T[1])
        out[sector]=(1,r[1][0]["out_order_id"] if r[0]==200 and isinstance(r[1],list) and r[1] else None,r)
    for cat in ("market","food"):
        pr=call("/rest/v1/products?select=id&active=eq.true&stock=gt.5&category=eq."+cat+"&limit=1",None,T[9])[1]
        r=rpc("place_product_order",{"p_product":pr[0]["id"],"p_qty":1,"p_address":addr},T[9]) if pr else (0,"no product")
        out["store/"+cat]=(9,r[1][0]["out_order_id"] if r[0]==200 and isinstance(r[1],list) and r[1] else None,r)
    doc=[x for x in call("/rest/v1/providers?select=id,kind&user_id=not.is.null",None,T[5])[1] if x["kind"]=="doctor"][0]
    day=(datetime.datetime.utcnow()+datetime.timedelta(days=3+random.randint(0,20))).strftime("%Y-%m-%d")
    sl=rpc("clinic_available_slots",{"p_provider":doc["id"],"p_day":day},T[9])
    slot=sl[1][random.randrange(len(sl[1]))]["slot"] if sl[0]==200 and sl[1] else None
    r=rpc("book_clinic_slot",{"p_provider":doc["id"],"p_at":slot,"p_notes":"إشعارات (تجريبي)"},T[9]) if slot else (0,"no slot")
    out["clinic"]=(9,r[1][0]["out_order_id"] if r[0]==200 and isinstance(r[1],list) and r[1] else None,r)
    return out
EXPECTED=["maintenance","car","store/market","store/food","clinic"]
fo=fresh_orders();covered=[]
for k in EXPECTED:
    who,oid,r=fo[k]
    if not oid:
        chk("sector %s: fresh order created (a rate-limit or fixture refusal is a FAIL, not a pass)"%k,False,msg(r));continue
    other=1 if who==9 else 9
    b=len(N(T[who])[1]);bo=len(N(T[other])[1])
    r=rpc("staff_set_order_status_v2",{"p_order":oid,"p_to":"cancelled","p_note":None},T[2])
    if r[0] not in(200,204): chk("sector %s: staff status change"%k,False,msg(r));continue
    nn=N(T[who])[1]
    chk("sector %s (user %d): owner got exactly one order_status row for that order"%(k,who),len(nn)==b+1 and nn[-1]["kind"]=="order_status" and nn[-1]["ref_id"]==oid,nn[-1] if nn else None)
    chk("sector %s: the other customer got nothing"%k,len(N(T[other])[1])==bo)
    covered.append(k)
print("SECTORS EXERCISED:",covered)
print("SECTORS OMITTED:",[k for k in EXPECTED if k not in covered])
for k in ("delivery requests","prescription answers","lab price changes","course/session changes","doctor notes"):
    print("OMITTED EVENT TYPE (no notification source exists yet):",k)
# --- applied request produces ONE visible result (the real change), not two ---
o=call("/rest/v1/orders?select=id,status&sector=eq.nursing&status=eq.confirmed&order=created_at.desc&limit=20",None,T[9])[1]
c=o[0]["id"]
r=rpc("customer_request_order_change",{"p_order":c,"p_kind":"cancel"},T[9]);rid=r[1];chk("owner requests cancel",r[0]==200,msg(r))
b=len(N(T[9])[1])
r=rpc("staff_set_order_status_v2",{"p_order":c,"p_to":"cancelled","p_note":None},T[2]);chk("staff really cancels",r[0] in(200,204),msg(r))
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"applied"},T[2]);chk("applied accepted after the real cancel",r[0] in(200,204),msg(r))
nn=N(T[9])[1];chk("exactly one new row for cancel+applied (no duplicate)",len(nn)==b+1 and nn[-1]["kind"]=="order_status" and nn[-1]["ref_id"]==c,[x["kind"] for x in nn[b:]])
chk("no change_request_applied row is ever created",all(x["kind"]!="change_request_applied" for x in nn))
