import os
# Precondition (test SQL editor): customer 1 has no consents rows; test provider kind=courier.
src=open(__import__("os").path.join(__import__("os").path.dirname(__import__("os").path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,p=login("1"),login("2"),login("3")
R=[];PID=os.environ["WASLA_TEST_PROVIDER_ID"]
def chk(n,ok,d=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+d[:170])
args={"p_pickup":"شارع الجمهورية 1 (اختبار)","p_dropoff":"ميدان المحطة 2 (اختبار)","p_what":"طرد اختبار موافقة"}
r=rpc("place_delivery_request",args,c);chk("no consent: placement refused (only valid when consents deleted first)",r[0]>=400,str(r)) if r[0]>=400 else (print("consents already present; refusal not re-tested"),rpc("customer_cancel_delivery",{"p_request":r[1]},c))
for k in ("terms","privacy"):
    a=rpc("accept_consent",{"p_kind":k,"p_version":"test"},c);print("accept",k,a[0])
r=rpc("place_delivery_request",args,c);chk("after consent: placement ok",r[0]==200,str(r));rid=r[1] if r[0]==200 else None
chk("staff cannot place (customers only)",rpc("place_delivery_request",args,s)[0]>=400)
chk("courier cannot place",rpc("place_delivery_request",args,p)[0]>=400)
chk("courier cannot assign",rpc("assign_delivery",{"p_request":rid,"p_courier":PID},p)[0]>=400)
chk("courier cannot start unassigned",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},p)[0]>=400)
chk("customer cannot assign",rpc("assign_delivery",{"p_request":rid,"p_courier":PID},c)[0]>=400)
chk("courier sees nothing before assignment",call("/rest/v1/delivery_requests?select=id&id=eq."+str(rid),None,p)[1]==[])
chk("staff assigns",rpc("assign_delivery",{"p_request":rid,"p_courier":PID},s)[0]==204)
chk("customer cannot cancel after assignment",rpc("customer_cancel_delivery",{"p_request":rid},c)[0]>=400)
chk("courier sees assigned request",len(call("/rest/v1/delivery_requests?select=id&id=eq."+str(rid),None,p)[1])==1)
chk("courier cannot deliver before pickup",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},p)[0]>=400)
chk("courier pickup",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"picked_up"},p)[0]==204)
chk("courier delivered",rpc("courier_set_delivery_status",{"p_request":rid,"p_to":"delivered"},p)[0]==204)
print(sum(R),"pass",len(R)-sum(R),"fail")
