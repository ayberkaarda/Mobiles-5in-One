<!-- ZAP 2.17.0 API scan, authenticated user, throttled to stay under the global limit. Trimmed to 5 instances per alert. `{api}` stands for http://api:8080, the API on the compose network. -->
# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 1 |
| Medium | 0 |
| Low | 1 |
| Informational | 3 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Medium | Exceeded High | {api} | Percentage of responses with status code 4xx | 98 % |
| Info | Informational | {api} | Percentage of responses with status code 2xx | 1 % |
| Info | Informational | {api} | Percentage of endpoints with content type application/json | 6 % |
| Info | Informational | {api} | Percentage of endpoints with content type application/problem+json | 93 % |
| Info | Informational | {api} | Percentage of endpoints with method DELETE | 2 % |
| Info | Informational | {api} | Percentage of endpoints with method GET | 51 % |
| Info | Informational | {api} | Percentage of endpoints with method PATCH | 5 % |
| Info | Informational | {api} | Percentage of endpoints with method POST | 37 % |
| Info | Informational | {api} | Percentage of endpoints with method PUT | 3 % |
| Info | Informational | {api} | Count of total endpoints | 191    |
| Info | Informational | {api} | Percentage of slow responses | 1 % |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| PII Disclosure | High | 1 |
| A Server Error response code was returned by the server | Low | 1 |
| A Client Error response code was returned by the server | Informational | 220 |
| Authentication Request Identified | Informational | 2 |
| Non-Storable Content | Informational | Systemic |




## Alert Detail



### [ PII Disclosure ](https://www.zaproxy.org/docs/alerts/10062/)



##### High (High)

### Description

The response contains Personally Identifiable Information, such as CC number, SSN and similar sensitive data.

* URL: {api}/v1/subscriptions/verify
  * Node Name: `{api}/v1/subscriptions/verify ()({productId,basePlanId,purchaseToken})`
  * Method: `POST`
  * Parameter: ``
  * Attack: ``
  * Evidence: `4481712896511`
  * Other Info: `Credit Card Type detected: Visa
Bank Identification Number: 448171
Brand: VISA
Category: CLASSIC
Issuer: COMMONWEALTH BANK AND TRUST COMPANY`


Instances: 1

### Solution

Check the response for the potential presence of personally identifiable information (PII), ensure nothing sensitive is leaked by the application.

### Reference



#### CWE Id: [ 359 ](https://cwe.mitre.org/data/definitions/359.html)


#### WASC Id: 13

#### Source ID: 3

### [ A Server Error response code was returned by the server ](https://www.zaproxy.org/docs/alerts/100000/)



##### Low (High)

### Description

A response code of 500 was returned by the server.
This may indicate that the application is failing to handle unexpected input correctly.
Raised by the 'Alert on HTTP Response Code Error' script

* URL: {api}/v1/adoptions%3Fdistrict=%2500&species=Cat&page=1&pageSize=20
  * Node Name: `{api}/v1/adoptions (district,page,pageSize,species)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `500`
  * Other Info: ``


Instances: 1

### Solution



### Reference



#### CWE Id: [ 388 ](https://cwe.mitre.org/data/definitions/388.html)


#### WASC Id: 20

#### Source ID: 4

### [ A Client Error response code was returned by the server ](https://www.zaproxy.org/docs/alerts/100000/)



##### Informational (High)

### Description

A response code of 401 was returned by the server.
This may indicate that the application is failing to handle unexpected input correctly.
Raised by the 'Alert on HTTP Response Code Error' script

* URL: {api}/v1/animals/id/follow
  * Node Name: `{api}/v1/animals/id/follow`
  * Method: `DELETE`
  * Parameter: ``
  * Attack: ``
  * Evidence: `404`
  * Other Info: ``
* URL: {api}/v1/animals/id/follow/
  * Node Name: `{api}/v1/animals/id/follow/`
  * Method: `DELETE`
  * Parameter: ``
  * Attack: ``
  * Evidence: `404`
  * Other Info: ``
* URL: {api}/v1/me/device-token
  * Node Name: `{api}/v1/me/device-token ()({token})`
  * Method: `DELETE`
  * Parameter: ``
  * Attack: ``
  * Evidence: `400`
  * Other Info: ``
* URL: {api}/v1/me/device-token
  * Node Name: `{api}/v1/me/device-token ()({token})`
  * Method: `DELETE`
  * Parameter: ``
  * Attack: ``
  * Evidence: `429`
  * Other Info: ``
* URL: {api}/v1/me/device-token/
  * Node Name: `{api}/v1/me/device-token/ ()({token})`
  * Method: `DELETE`
  * Parameter: ``
  * Attack: ``
  * Evidence: `400`
  * Other Info: ``
* ... 215 more instances (trimmed; the full report is reproducible with the command in ../zap.md)
Instances: 220

### Solution



### Reference



#### CWE Id: [ 388 ](https://cwe.mitre.org/data/definitions/388.html)


#### WASC Id: 20

#### Source ID: 4

### [ Authentication Request Identified ](https://www.zaproxy.org/docs/alerts/10111/)



##### Informational (Low)

### Description

The given request has been identified as an authentication request. The 'Other Info' field contains a set of key=value lines which identify any relevant fields. If the request is in a context which has an Authentication Method set to "Auto-Detect" then this rule will change the authentication to match the request identified.

* URL: {api}/v1/auth/reset
  * Node Name: `{api}/v1/auth/reset ()({email,code,newPassword})`
  * Method: `POST`
  * Parameter: `email`
  * Attack: ``
  * Evidence: `newPassword`
  * Other Info: `userParam=email
userValue=zaproxy@example.com
passwordParam=newPassword`
* URL: {api}/v1/auth/login
  * Node Name: `{api}/v1/auth/login ()({email,password})`
  * Method: `POST`
  * Parameter: `email`
  * Attack: ``
  * Evidence: `password`
  * Other Info: `userParam=email
userValue=zaproxy@example.com
passwordParam=password`


Instances: 2

### Solution

This is an informational alert rather than a vulnerability and so there is nothing to fix.

### Reference


* [ https://www.zaproxy.org/docs/desktop/addons/authentication-helper/auth-req-id/ ](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/auth-req-id/)



#### Source ID: 3

### [ Non-Storable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are not storable by caching components such as proxy servers. If the response does not contain sensitive, personal or user-specific information, it may benefit from being stored and cached, to improve performance.

* URL: {api}/health/bff
  * Node Name: `{api}/health/bff`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: {api}/v1/care-places%3Fnear=near&kind=Vet&open24h=true&radius=5000&page=1&pageSize=20
  * Node Name: `{api}/v1/care-places (kind,near,open24h,page,pageSize,radius)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: {api}/v1/health
  * Node Name: `{api}/v1/health`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: {api}/v1/auth/mfa
  * Node Name: `{api}/v1/auth/mfa ()({mfaToken,code,recoveryCode})`
  * Method: `POST`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: {api}/webhooks/play
  * Node Name: `{api}/webhooks/play`
  * Method: `POST`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``

Instances: Systemic


### Solution

The content may be marked as storable by ensuring that the following conditions are satisfied:
The request method must be understood by the cache and defined as being cacheable ("GET", "HEAD", and "POST" are currently defined as cacheable)
The response status code must be understood by the cache (one of the 1XX, 2XX, 3XX, 4XX, or 5XX response classes are generally understood)
The "no-store" cache directive must not appear in the request or response header fields
For caching by "shared" caches such as "proxy" caches, the "private" response directive must not appear in the response
For caching by "shared" caches such as "proxy" caches, the "Authorization" header field must not appear in the request, unless the response explicitly allows it (using one of the "must-revalidate", "public", or "s-maxage" Cache-Control response directives)
In addition to the conditions above, at least one of the following conditions must also be satisfied by the response:
It must contain an "Expires" header field
It must contain a "max-age" response directive
For "shared" caches such as "proxy" caches, it must contain a "s-maxage" response directive
It must contain a "Cache Control Extension" that allows it to be cached
It must have a status code that is defined as cacheable by default (200, 203, 204, 206, 300, 301, 404, 405, 410, 414, 501).

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3


