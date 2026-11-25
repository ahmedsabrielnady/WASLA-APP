# Post-confirmation change/cancel REQUEST on nursing orders. Request only: the order never changes by itself. wasla-test only, synthetic.
import os
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T={n:login(str(n)) for n in (1,2,5,9)}
def chk(n,ok,x=""):print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
# Self-contained fixture (synthetic, wasla-test only): create the new / confirmed / done nursing orders here instead of relying on leftovers from earlier runs.
import uuid
def _mk():
    r=rpc("request_nursing_visit",{"p_item":15,"p_address":"عنوان اختبار طلب تغيير","p_notes":"synthetic","p_idempotency_key":str(uuid.uuid4())},T[9])
    assert r[0]==200,("fixture: nursing request failed",r[0],msg(r))
    return call("/rest/v1/orders?select=id,status&sector=eq.nursing&order=created_at.desc&limit=1",None,T[9])[1][0]["id"]
_doc=call("/rest/v1/providers?select=id,kind&kind=eq.doctor&user_id=not.is.null",None,T[5])[1][0]["id"]
n0=_mk();c0=_mk();d0=_mk()
for _o in (c0,d0):
    _r=rpc("assign_order_v2",{"p_order":_o,"p_provider":_doc},T[2]);assert _r[0] in(200,204),("fixture: assign failed",_r[0],msg(_r))
for _to in ("in_progress","done"):
    _r=rpc("provider_set_order_status_v2",{"p_order":d0,"p_to":_to},T[5]);assert _r[0] in(200,204),("fixture: provider move failed",_to,_r[0],msg(_r))
_s={x["id"]:x["status"] for x in call("/rest/v1/orders?select=id,status&id=in.("+",".join((n0,c0,d0))+")",None,T[9])[1]}
assert _s=={n0:"new",c0:"confirmed",d0:"done"},("fixture: unexpected statuses",_s)
ip0=_mk();_r=rpc("assign_order_v2",{"p_order":ip0,"p_provider":_doc},T[2]);assert _r[0] in(200,204),("fixture: assign failed",_r[0],msg(_r))
_r=rpc("provider_set_order_status_v2",{"p_order":ip0,"p_to":"in_progress"},T[5]);assert _r[0] in(200,204),("fixture: in_progress failed",_r[0],msg(_r))
assert call("/rest/v1/orders?select=status&id=eq."+ip0,None,T[9])[1][0]["status"]=="in_progress","fixture: ip order not in_progress"
o=call("/rest/v1/orders?select=id,ref,status&sector=eq.nursing&order=created_at.asc&limit=1000",None,T[9])[1]
by=lambda s:[x for x in o if x["status"]==s]
for x in call("/rest/v1/order_change_requests?select=id&status=eq.open&order_id=eq."+c0,None,T[2])[1]:rpc("staff_resolve_order_change",{"p_request":x["id"],"p_status":"declined"},T[2])  # reset leftovers from an aborted earlier run
st=lambda i:call("/rest/v1/orders?select=status&id=eq."+i,None,T[9])[1][0]["status"]
R=lambda t,b:rpc("customer_request_order_change",b,t)
code=lambda r:(r[0],"22023" in str(r) and "22023" or ("42501" in str(r) and "42501" or ""))
r=R(T[1],{"p_order":c0,"p_kind":"cancel"});chk("other customer refused (403)",r[0]==403,msg(r))
r=R(T[9],{"p_order":n0,"p_kind":"cancel"});chk("new order refused (400, use normal cancel)",r[0]==400,msg(r))
r=R(T[9],{"p_order":d0,"p_kind":"cancel"});chk("done order refused (400)",r[0]==400,msg(r))
r=R(T[9],{"p_order":c0,"p_kind":"refund"});chk("invalid kind refused (400)",r[0]==400,msg(r))
r=R(T[9],{"p_order":c0,"p_kind":"cancel","p_note":"x"*301});chk("note over 300 refused (400)",r[0]==400,msg(r))
r=R(T[9],{"p_order":c0,"p_kind":"cancel","p_note":"ظروف طارئة (تجريبي)"});chk("owner requests cancel",r[0]==200,msg(r))
rid=r[1] if r[0]==200 else None
chk("order NOT cancelled automatically",st(c0)=="confirmed",st(c0))
r=R(T[9],{"p_order":c0,"p_kind":"cancel"});chk("duplicate open request refused (400)",r[0]==400,msg(r))
r=R(T[9],{"p_order":c0,"p_kind":"change_time"});chk("owner requests time change (different kind)",r[0]==200,msg(r));rid2=r[1] if r[0]==200 else None
chk("order unchanged",st(c0)=="confirmed")
g=lambda t:call("/rest/v1/order_change_requests?select=id,kind,status&id=in.(%s,%s)"%(rid,rid2),None,t)
chk("owner reads own 2 requests",len(g(T[9])[1])==2,g(T[9])[1])
chk("other customer reads none",g(T[1])[1]==[])
chk("doctor reads none",g(T[5])[1]==[])
chk("staff reads both",len(g(T[2])[1])==2)
r=call("/rest/v1/order_change_requests",{"order_id":c0,"customer_id":"00000000-0000-0000-0000-000000000000","kind":"cancel"},T[9],"POST");chk("direct INSERT refused",r[0] in(401,403),r[0])
r=call("/rest/v1/order_change_requests?id=eq."+str(rid),{"status":"handled"},T[9],"PATCH");chk("direct UPDATE by customer refused",r[0] in(401,403),r[0])
r=call("/rest/v1/order_change_requests?id=eq."+str(rid),None,T[9],"DELETE");chk("direct DELETE by customer refused",r[0] in(401,403),r[0])
chk("rows intact",len(g(T[2])[1])==2 and all(x["status"]=="open" for x in g(T[2])[1]))
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"applied"},T[9]);chk("customer cannot handle (403)",r[0]==403,msg(r))
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"applied"},T[5]);chk("doctor cannot handle (403)",r[0]==403,msg(r))
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"bogus"},T[2]);chk("staff invalid status (400)",r[0]==400,msg(r))
# fixture: make a synthetic in_progress nursing order (new -> confirmed -> in_progress through the staff RPC) if none exists
ST=lambda i,s:rpc("staff_set_order_status_v2",{"p_order":i,"p_to":s,"p_note":None},T[2])
if not by("in_progress"):
    spare=[x for x in by("new") if x["id"]!=n0]
    if spare:
        doc=[p for p in call("/rest/v1/providers?select=id,kind&user_id=not.is.null",None,T[5])[1] if p["kind"]=="doctor"][0]
        a=rpc("assign_order_v2",{"p_order":spare[0]["id"],"p_provider":doc["id"]},T[2]);b=rpc("provider_set_order_status_v2",{"p_order":spare[0]["id"],"p_to":"in_progress"},T[5]);chk("fixture: synthetic order assigned to the credentialed test doctor, then started by that provider",a[0] in(200,204) and b[0] in(200,204),(msg(a),msg(b)))
    o=call("/rest/v1/orders?select=id,ref,status&sector=eq.nursing&order=created_at.asc&limit=100",None,T[9])[1]
ip=[{"id":ip0}]  # the order created by this test
if ip:
    r=R(T[9],{"p_order":ip[0]["id"],"p_kind":"change_time"});chk("in_progress: time change refused (staff cannot reschedule it) (400)",r[0]==400,msg(r))
else: print("SKIP no in_progress fixture")
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"applied"},T[2]);chk("applied refused while order is NOT cancelled (400)",r[0]==400 and st(c0)=="confirmed",msg(r))
r=rpc("staff_resolve_order_change",{"p_request":rid2,"p_status":"applied"},T[2]);chk("applied refused for time change when no appointment change happened (400)",r[0]==400,msg(r))
chk("both requests still open after refused applies",all(x["status"]=="open" for x in g(T[2])[1]) and len(g(T[2])[1])==2)
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"declined"},T[2]);chk("staff declines the cancel request (reviewed, nothing changed)",r[0] in(200,204),msg(r))
chk("declined request: order still confirmed",st(c0)=="confirmed")
r=rpc("staff_resolve_order_change",{"p_request":rid,"p_status":"declined"},T[2]);chk("resolved twice refused (400)",r[0]==400,msg(r))
r=rpc("staff_schedule_order",{"p_order":c0,"p_at":(__import__("datetime").datetime.utcnow()+__import__("datetime").timedelta(days=20,seconds=__import__("random").randint(1,3000))).strftime("%Y-%m-%dT%H:%M:%SZ")},T[2]);chk("positive control: staff sets a new appointment",r[0] in(200,204),msg(r))
r=rpc("staff_resolve_order_change",{"p_request":rid2,"p_status":"applied"},T[2]);chk("applied accepted after the appointment really changed",r[0] in(200,204),msg(r))
chk("final statuses",sorted(x["status"] for x in g(T[2])[1])==["applied","declined"],g(T[2])[1])
chk("order still confirmed",st(c0)=="confirmed")
r=R(T[9],{"p_order":c0,"p_kind":"cancel"});chk("new request allowed after resolved",r[0]==200,msg(r))
rpc("staff_resolve_order_change",{"p_request":r[1],"p_status":"declined"},T[2])

if ip:
    i0=ip[0]["id"]
    r=R(T[9],{"p_order":i0,"p_kind":"cancel","p_note":"طارئ (تجريبي)"});chk("in_progress: cancel request accepted (200)",r[0]==200,msg(r));rc=r[1] if r[0]==200 else None
    chk("in_progress order unchanged by the request",st(i0)=="in_progress",st(i0))
    r=rpc("staff_resolve_order_change",{"p_request":rc,"p_status":"applied"},T[2]);chk("in_progress: applied refused while not cancelled (400)",r[0]==400,msg(r))
    r=ST(i0,"cancelled");chk("positive control: staff really cancels the in_progress order",r[0] in(200,204) and st(i0)=="cancelled",(msg(r),st(i0)))
    r=rpc("staff_resolve_order_change",{"p_request":rc,"p_status":"applied"},T[2]);chk("positive control: applied accepted after real cancellation",r[0] in(200,204),msg(r))
    chk("request now applied",call("/rest/v1/order_change_requests?select=status&id=eq."+str(rc),None,T[9])[1][0]["status"]=="applied")
