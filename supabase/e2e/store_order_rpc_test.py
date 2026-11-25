# Self-contained: creates its own two products through merchant_add_product as merchant user 7 (P1: 40 EGP stock 5, P2: 25 EGP stock 1), so earlier runs cannot drift the stock. Server-side discount pricing is NOT covered here (merchant_add_product takes no discount); see the report.
import os,threading
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
c,s,m=login("1"),login("2"),login("7")
R=[]
def _add(n,p,st_):
    r=rpc("merchant_add_product",{"p_name":n,"p_category":"market","p_price":p,"p_stock":st_},m);assert r[0]==200,("fixture: merchant_add_product failed",r[0],str(r[1])[:80])
    x=call("/rest/v1/products?select=id,stock,price_egp,active&name=eq."+__import__("urllib.parse").parse.quote(n)+"&order=id.desc&limit=1",None,m)[1][0];assert x["stock"]==st_ and x["price_egp"]==p and x["active"],("fixture: product not as created",x);return x["id"]
import uuid as _u
_t=_u.uuid4().hex[:6]
P1=_add("منتج اختبار مخزون "+_t,40,5);P2=_add("منتج اختبار آخر وحدة "+_t,25,1)
def chk(n,ok,x=""):R.append(ok);print(("PASS " if ok else "FAIL ")+n+" | "+str(x)[:170])
def stock(i):return call("/rest/v1/products?select=stock&id=eq."+str(i),None,m)[1][0]["stock"]
chk("customer reads active products",len(call("/rest/v1/products?select=id&active=eq.true",None,c)[1])>=2)
st,b=rpc("place_product_order",{"p_product":P1,"p_qty":2,"p_address":"عنوان اختبار 12"},c);chk("order 2 x 40",st==200 and b[0]["out_total"]==80,b)
o1=b[0]["out_order_id"] if st==200 else None
chk("stock decreased to 3",stock(P1)==3,stock(P1))
chk("qty above stock refused",rpc("place_product_order",{"p_product":P1,"p_qty":4,"p_address":"عنوان اختبار 12"},c)[0]>=400)
chk("qty 0 refused",rpc("place_product_order",{"p_product":P1,"p_qty":0,"p_address":"عنوان اختبار 12"},c)[0]>=400)
chk("qty 21 refused",rpc("place_product_order",{"p_product":P1,"p_qty":21,"p_address":"عنوان اختبار 12"},c)[0]>=400)
chk("unknown product refused",rpc("place_product_order",{"p_product":9999,"p_qty":1,"p_address":"عنوان اختبار 12"},c)[0]>=400)
res=[]
def go():res.append(rpc("place_product_order",{"p_product":P2,"p_qty":1,"p_address":"عنوان اختبار 12"},c)[0])
t=[threading.Thread(target=go) for _ in range(4)];[x.start() for x in t];[x.join() for x in t]
chk("4 concurrent buys of last unit: exactly one succeeds",res.count(200)==1 and stock(P2)==0,(res,stock(P2)))
chk("server-side price used (25 EGP set by the merchant; discount pricing not covered)",call("/rest/v1/orders?select=price_egp&product_id=eq."+str(P2)+"&order=created_at.desc&limit=1",None,c)[1][0]["price_egp"]==25)
chk("customer cancels new order -> stock restored",rpc("customer_cancel_order_v2",{"p_order":o1},c)[0] in (200,204) and stock(P1)==5,stock(P1))
r=rpc("customer_cancel_order_v2",{"p_order":o1},c);chk("repeat cancel does not restore stock twice (idempotent or refused)",r[0]>=400 or stock(P1)==5,(r[0],stock(P1)))
st,b=rpc("place_product_order",{"p_product":P1,"p_qty":1,"p_address":"عنوان اختبار 12"},c);o2=b[0]["out_order_id"]
mo=call("/rest/v1/orders?select=id,status&id=eq."+o2,None,m)[1]
chk("merchant sees order for own product",len(mo)==1,mo)
chk("other customer-role (staff) merchant status denied",rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":"confirmed"},s)[0]>=400)
chk("customer cannot set provider status",rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":"confirmed"},c)[0]>=400)
chk("merchant cannot confirm (staff step)",rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":"confirmed"},m)[0]>=400)
chk("staff confirms",rpc("staff_set_order_status_v2",{"p_order":o2,"p_to":"confirmed"},s)[0] in (200,204))
chk("merchant skip to done refused",rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":"done"},m)[0]>=400)
for to in ("in_progress","done"):
    r=rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":to},m);print("  merchant ->",to,msg(r))
chk("merchant reaches done",call("/rest/v1/orders?select=status&id=eq."+o2,None,c)[1][0]["status"]=="done")
chk("repeat done refused",rpc("provider_set_order_status_v2",{"p_order":o2,"p_to":"done"},m)[0]>=400)
print(sum(R),"pass",len(R)-sum(R),"fail")
