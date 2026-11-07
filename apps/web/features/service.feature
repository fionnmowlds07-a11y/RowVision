Feature: The running service

  Scenario: Everything is healthy
    When I ask for the deep health check
    Then the service reports that it is healthy

  Scenario: A stranger cannot join by calling the API directly
    When "direct-stranger@example.com" asks for a sign-in code from the API
    Then they are refused

  Scenario: A signed-out visitor cannot read clips
    When I read the clips table without signing in
    Then I am refused

  Scenario: A signed-out visitor cannot list storage
    When I list the working bucket without signing in
    Then I see no files

  Scenario: Deletion cannot be started by just anyone
    When I start the 30-day deletion without the secret
    Then I am refused

  Scenario: Deletion runs for the scheduler
    When I start the 30-day deletion with the secret
    Then it reports how many clips it deleted
