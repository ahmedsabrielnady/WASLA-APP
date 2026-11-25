# Merchant-state gate for place_product_order. Needs the SQL bracket in product_order_state_gate_fixture.sql:
#   usage: product_order_state_gate_test.py <label> <product_id> <refuse|allow>
# refuse = the order must fail with 22023 (product not available) and create no order; allow = positive control, the order must succeed (the test cancels it, stock restored).
# A 500 / 53400 (rate limit) is never a pass.
import os,sys
src=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),"e2e_rpc.py")).read().split('c,s,p=login')[0]
exec(src)
# customer 9 is used so the refusal tests are not hidden behind customer 1's order rate limit
c=login("9");m=login("7");A="عنوان اختبار حالة التاجر"
label,pid,mode=sys.argv[1],int(sys.argv[2]),sys.argv[3]
assert mode in ("refuse","allow")
# A blocked merchant's product is invisible to everyone through REST (RLS), so "no side effect" is checked as: the customer's own order count for that product did not change.
def n_orders():return len(call("/rest/v1/orders?select=id&product_id=eq."+str(pid),None,c)[1])
def stock():
    r=call("/rest/v1/products?select=stock&id=eq."+str(pid),None,m)[1]
    return r[0]["stock"] if r else None
vis=len(call("/rest/v1/products?select=id&id=eq."+str(pid),None,c)[1])
n0=n_orders()
s0=stock()
st,b=rpc("place_product_order",{"p_product":pid,"p_qty":1,"p_address":A},c)
code=b.get("code") if isinstance(b,dict) else None
if mode=="refuse":
    ok=st==400 and code=="22023" and n_orders()==n0
    print(("PASS " if ok else "FAIL ")+label+" refused with 22023 and no order created | "+str((st,code,n0,n_orders(),"customer sees product rows:",vis)))
else:
    ok=st==200 and n_orders()==n0+1 and stock()==s0-1
    print(("PASS " if ok else "FAIL ")+label+" positive control: order accepted, stock -1 | "+str((st,code,s0,stock())))
    if ok:
        o=b[0]["out_order_id"];r=rpc("customer_cancel_order_v2",{"p_order":o},c)
        ok2=r[0] in (200,204) and stock()==s0
        print(("PASS " if ok2 else "FAIL ")+label+" cancel restores stock | "+str((r[0],s0,stock())))
