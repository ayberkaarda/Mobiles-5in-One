<!-- ZAP 2.17.0 baseline, admin sign-in, after the fixes. Trimmed to 5 instances per alert. -->
# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 0 |
| Low | 1 |
| Informational | 6 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Info | Informational | http://host.docker.internal:25001 | Percentage of responses with status code 2xx | 98 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of responses with status code 3xx | 1 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type application/xml | 1 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type font/woff2 | 2 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type image/png | 1 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type image/svg+xml | 3 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type text/css | 5 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type text/html | 83 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with content type text/plain | 1 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with method GET | 97 % |
| Info | Informational | http://host.docker.internal:25001 | Percentage of endpoints with method POST | 2 % |
| Info | Informational | http://host.docker.internal:25001 | Count of total endpoints | 80    |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| Cross-Origin-Embedder-Policy Header Missing or Invalid | Low | Systemic |
| Authentication Request Identified | Informational | 2 |
| Non-Storable Content | Informational | 3 |
| Retrieved from Cache | Informational | Systemic |
| Session Management Response Identified | Informational | 2 |
| Storable and Cacheable Content | Informational | Systemic |
| User Controllable HTML Element Attribute (Potential XSS) | Informational | 6 |




## Alert Detail



### [ Cross-Origin-Embedder-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Embedder-Policy header is a response header that prevents a document from loading any cross-origin resources that don't explicitly grant the document permission (using CORP or CORS).

* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: http://host.docker.internal:25001/admin/giris%3FReturnUrl=%252Fadmin
  * Node Name: `http://host.docker.internal:25001/admin/giris (ReturnUrl)`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: http://host.docker.internal:25001/bakim-yerleri
  * Node Name: `http://host.docker.internal:25001/bakim-yerleri`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: http://host.docker.internal:25001/sahiplendirme
  * Node Name: `http://host.docker.internal:25001/sahiplendirme`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: http://host.docker.internal:25001/sitemap.xml
  * Node Name: `http://host.docker.internal:25001/sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that the application/web server sets the Cross-Origin-Embedder-Policy header appropriately, and that it sets the Cross-Origin-Embedder-Policy header to 'require-corp' for documents.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Embedder-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Authentication Request Identified ](https://www.zaproxy.org/docs/alerts/10111/)



##### Informational (Low)

### Description

The given request has been identified as an authentication request. The 'Other Info' field contains a set of key=value lines which identify any relevant fields. If the request is in a context which has an Authentication Method set to "Auto-Detect" then this rule will change the authentication to match the request identified.

* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris ()(Email,Password,__RequestVerificationToken)`
  * Method: `POST`
  * Parameter: `Email`
  * Attack: ``
  * Evidence: `Password`
  * Other Info: `userParam=Email
userValue=zaproxy@example.com
passwordParam=Password
referer=http://host.docker.internal:25001/admin/giris
csrfToken=__RequestVerificationToken`
* URL: http://host.docker.internal:25001/admin/giris%3FReturnUrl=%252Fadmin
  * Node Name: `http://host.docker.internal:25001/admin/giris (ReturnUrl)(Email,Password,__RequestVerificationToken)`
  * Method: `POST`
  * Parameter: `Email`
  * Attack: ``
  * Evidence: `Password`
  * Other Info: `userParam=Email
userValue=zaproxy@example.com
passwordParam=Password
referer=http://host.docker.internal:25001/admin/giris?ReturnUrl=%2Fadmin
csrfToken=__RequestVerificationToken`


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

* URL: http://host.docker.internal:25001/admin
  * Node Name: `http://host.docker.internal:25001/admin`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``
* URL: http://host.docker.internal:25001/admin/giris%3FReturnUrl=%252Fadmin
  * Node Name: `http://host.docker.internal:25001/admin/giris (ReturnUrl)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `no-store`
  * Other Info: ``


Instances: 3

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

### [ Retrieved from Cache ](https://www.zaproxy.org/docs/alerts/10050/)



##### Informational (Medium)

### Description

The content was retrieved from a shared cache. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: http://host.docker.internal:25001/
  * Node Name: `http://host.docker.internal:25001/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Age: 29`
  * Other Info: `The presence of the 'Age' header indicates that a HTTP/1.1 compliant caching server is in use.`
* URL: http://host.docker.internal:25001/bakim-yerleri
  * Node Name: `http://host.docker.internal:25001/bakim-yerleri`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Age: 29`
  * Other Info: `The presence of the 'Age' header indicates that a HTTP/1.1 compliant caching server is in use.`
* URL: http://host.docker.internal:25001/robots.txt
  * Node Name: `http://host.docker.internal:25001/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Age: 29`
  * Other Info: `The presence of the 'Age' header indicates that a HTTP/1.1 compliant caching server is in use.`
* URL: http://host.docker.internal:25001/sahiplendirme
  * Node Name: `http://host.docker.internal:25001/sahiplendirme`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Age: 29`
  * Other Info: `The presence of the 'Age' header indicates that a HTTP/1.1 compliant caching server is in use.`
* URL: http://host.docker.internal:25001/sahiplendirme%3Ftur=kedi
  * Node Name: `http://host.docker.internal:25001/sahiplendirme (tur)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `Age: 29`
  * Other Info: `The presence of the 'Age' header indicates that a HTTP/1.1 compliant caching server is in use.`

Instances: Systemic


### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.rfc-editor.org/rfc/rfc9110.html ](https://www.rfc-editor.org/rfc/rfc9110.html)


#### CWE Id: [ 525 ](https://cwe.mitre.org/data/definitions/525.html)


#### Source ID: 3

### [ Session Management Response Identified ](https://www.zaproxy.org/docs/alerts/10112/)



##### Informational (Medium)

### Description

The given response has been identified as containing a session management token. The 'Other Info' field contains a set of header tokens that can be used in the Header Based Session Management Method. If the request is in a context which has a Session Management Method set to "Auto-Detect" then this rule will change the session management to use the tokens identified.

* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris`
  * Method: `GET`
  * Parameter: `.AspNetCore.Antiforgery.Yhg7o9PVPFM`
  * Attack: ``
  * Evidence: `.AspNetCore.Antiforgery.Yhg7o9PVPFM`
  * Other Info: `cookie:.AspNetCore.Antiforgery.Yhg7o9PVPFM`
* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris`
  * Method: `GET`
  * Parameter: `.AspNetCore.Antiforgery.Yhg7o9PVPFM`
  * Attack: ``
  * Evidence: `.AspNetCore.Antiforgery.Yhg7o9PVPFM`
  * Other Info: `cookie:.AspNetCore.Antiforgery.Yhg7o9PVPFM`


Instances: 2

### Solution

This is an informational alert rather than a vulnerability and so there is nothing to fix.

### Reference


* [ https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/ ](https://www.zaproxy.org/docs/desktop/addons/authentication-helper/session-mgmt-id/)



#### Source ID: 3

### [ Storable and Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, and may be retrieved directly from the cache, rather than from the origin server by the caching servers, in response to similar requests from other users. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where "shared" caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: http://host.docker.internal:25001/css/tokens.css%3Fv=0Zffs-teo64QAwbWaQjx0YmMbsnJ7JrKindGo-Dbhu0
  * Node Name: `http://host.docker.internal:25001/css/tokens.css (v)`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: http://host.docker.internal:25001/favicon.svg
  * Node Name: `http://host.docker.internal:25001/favicon.svg`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: http://host.docker.internal:25001/img/patika-lockup.svg
  * Node Name: `http://host.docker.internal:25001/img/patika-lockup.svg`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: http://host.docker.internal:25001/robots.txt
  * Node Name: `http://host.docker.internal:25001/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`
* URL: http://host.docker.internal:25001/sitemap.xml
  * Node Name: `http://host.docker.internal:25001/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: ``
  * Other Info: `In the absence of an explicitly specified caching lifetime directive in the response, a liberal lifetime heuristic of 1 year was assumed. This is permitted by rfc7234.`

Instances: Systemic


### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3

### [ User Controllable HTML Element Attribute (Potential XSS) ](https://www.zaproxy.org/docs/alerts/10031/)



##### Informational (Low)

### Description

This check looks at user-supplied input in query string parameters and POST data to identify where certain HTML attribute values might be controlled. This provides hot-spot detection for XSS (cross-site scripting) that will require further review by a security analyst to determine exploitability.

* URL: http://host.docker.internal:25001/sahiplendirme%3Filce&tur=kopek
  * Node Name: `http://host.docker.internal:25001/sahiplendirme (ilce,tur)`
  * Method: `GET`
  * Parameter: `tur`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

http://host.docker.internal:25001/sahiplendirme?ilce&tur=kopek

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
tur=kopek

The user-controlled value was:
kopek`
* URL: http://host.docker.internal:25001/sahiplendirme%3Ftur=kedi
  * Node Name: `http://host.docker.internal:25001/sahiplendirme (tur)`
  * Method: `GET`
  * Parameter: `tur`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

http://host.docker.internal:25001/sahiplendirme?tur=kedi

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
tur=kedi

The user-controlled value was:
kedi`
* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris ()(Email,Password,__RequestVerificationToken)`
  * Method: `POST`
  * Parameter: `Email`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

http://host.docker.internal:25001/admin/giris

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
Email=zaproxy@example.com

The user-controlled value was:
zaproxy@example.com`
* URL: http://host.docker.internal:25001/admin/giris
  * Node Name: `http://host.docker.internal:25001/admin/giris ()(Email,Password,__RequestVerificationToken)`
  * Method: `POST`
  * Parameter: `Password`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

http://host.docker.internal:25001/admin/giris

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
Password=ZAP

The user-controlled value was:
zaproxy@example.com`
* URL: http://host.docker.internal:25001/admin/giris%3FReturnUrl=%252Fadmin
  * Node Name: `http://host.docker.internal:25001/admin/giris (ReturnUrl)(Email,Password,__RequestVerificationToken)`
  * Method: `POST`
  * Parameter: `Email`
  * Attack: ``
  * Evidence: ``
  * Other Info: `User-controlled HTML attribute values were found. Try injecting special characters to see if XSS might be possible. The page at the following URL:

http://host.docker.internal:25001/admin/giris?ReturnUrl=%2Fadmin

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
Email=zaproxy@example.com

The user-controlled value was:
zaproxy@example.com`
* ... 1 more instances (trimmed; the full report is reproducible with the command in ../zap.md)
http://host.docker.internal:25001/admin/giris?ReturnUrl=%2Fadmin

appears to include user input in:
a(n) [input] tag [value] attribute

The user input found was:
Password=ZAP

The user-controlled value was:
zaproxy@example.com`


Instances: 6

### Solution

Validate all input and sanitize output it before writing to any HTML attributes.

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html ](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)


#### CWE Id: [ 20 ](https://cwe.mitre.org/data/definitions/20.html)


#### WASC Id: 20

#### Source ID: 3


