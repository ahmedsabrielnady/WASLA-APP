# Delivery notification end-to-end through the API. Precondition (test-data setup on wasla-test only): provider WASLA_TEST_PROVIDER_ID has kind='courier' and belongs to user 3.
import os
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
T={n:login(str(n)) for n in (1,2,3,9)}
PID=os.environ["WASLA_TEST_PROVIDER_ID"]
def chk(n,ok,x=""):print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:200])
N=lambda t:call("/rest/v1/notifications?select=id,user_id,kind,ref_id,read_at,created_at&order=created_at.asc",None,t)[1]
for k in ("terms","privacy"):rpc("accept_consent",{"p_kind":k,"p_version":"test"},T[1])
b1,b9,b3=N(T[1]),N(T[9]),N(T[3])
nw=lambda t,b:[x for x in N(t) if x["id"] not in {y["id"] for y in b}]
chk("courier provider is kind courier (precondition)",[x["kind"] for x in call("/rest/v1/providers?select=kind&id=eq."+PID,None,T[2])[1]]==["courier"])
r=rpc("place_delivery_request",{"p_pickup":"شارع الجمهورية 1 (اختبار)","p_dropoff":"ميدان المحطة 2 (اختبار)","p_what":"طرد اختبار إشعارات"},T[1]);chk("customer places a delivery request",r[0]==200,msg(r));rid=r[1]
chk("placing adds no notification",nw(T[1],b1)==[])
r=rpc("assign_delivery",{"p_request":rid,"p_courier":PID},T[2]);chk("staff assigns the courier",r[0] in(200,204),msg(r))
n=nw(T[1],b1);chk("assigned: one delivery_status row",len(n)==1 and n[0]["kind"]=="delivery_status" and n[0]["ref_id"]==rid,n)
chk("the courier can now see the request, customer 9 cannot",len(call("/rest/v1/delivery_requests?select=id&id=eq."+rid,None,T[3])[1])==1 and call("/rest/v1/delivery_requests?select=id&id=eq."+rid,None,T[9])[1]==[])
r=rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},T[3]);chk("courier cannot skip pickup (refused)",r[0]>=400,(r[0],msg(r)))
chk("a refused move adds no notification",len(nw(T[1],b1))==1)
r=rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},T[3]);chk("courier marks picked up",r[0]==204,msg(r))
r=rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},T[3]);chk("courier marks delivered",r[0]==204,msg(r))
n=nw(T[1],b1);chk("customer has exactly 3 delivery_status rows for that request",len(n)==3 and all(x["kind"]=="delivery_status" and x["ref_id"]==rid for x in n),[x["kind"] for x in n])
r=rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},T[3]);chk("repeat delivered refused",r[0]>=400,(r[0],msg(r)))
chk("repeat adds no row",len(nw(T[1],b1))==3)
chk("customer 9 and the courier got no rows",nw(T[9],b9)==[] and nw(T[3],b3)==[])
chk("customer 9 cannot read customer 1's row by id",call("/rest/v1/notifications?select=id&id=eq."+n[0]["id"],None,T[9])[1]==[])
# cancel path on a second request
r=rpc("place_delivery_request",{"p_pickup":"شارع الجمهورية 3 (اختبار)","p_dropoff":"ميدان المحطة 4 (اختبار)","p_what":"طرد اختبار إلغاء"},T[1]);chk("customer places a second request",r[0]==200,msg(r));r2=r[1]
r=rpc("customer_cancel_delivery",{"p_request":r2},T[1]);chk("customer cancels it",r[0] in(200,204),msg(r))
m=[x for x in nw(T[1],b1) if x["ref_id"]==r2];chk("a cancellation produces one delivery_status row (the customer's own action also notifies; labelled behavior)",len(m)==1,m)
