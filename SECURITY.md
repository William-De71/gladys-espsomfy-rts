# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
the ESPSomfy RTS firmware (report to
[its project](https://github.com/rstrouse/ESPSomfy-RTS)) and the Somfy
motors.

The integration holds no secret. Its `/data` volume keeps the server id,
address and host name of each controller seen. The HTTP API of an ESPSomfy
RTS controller (port 8081) has no authentication, even when a PIN or a
password protects its web page: anyone on your local network can move your
shades. Keep the controller on a trusted network, never exposed to the
Internet.
